// routes/documents.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const mongoose = require('mongoose');
const { requireRole, requireProjectAccess } = require('../middleware/rbac');
const Document = require('../models/Document');
const Project = require('../models/Project');
const ProjectChecklist = require('../models/ProjectChecklist');
const Unit = require('../models/Unit');

const router = express.Router();

/* =========================
   Configuración de subida
   ========================= */
const uploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname || '');
    cb(null, unique + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });
const multiUpload = upload.fields([{ name: 'files', maxCount: 20 }, { name: 'file', maxCount: 1 }]);


/* =========================
   Helpers de rol/ACL
   ========================= */
function norm(s) { return (s || '').toString().toLowerCase(); }
function toObjectId(id) { return new mongoose.Types.ObjectId(id); }

const FULL_ACCESS_ROLES = [
  'admin', 'bank', 'promoter', 'gerencia', 'socios', 'financiero', 'contable'
];
const LIMITED_ROLES = ['legal', 'tecnico', 'commercial'];

function isFullAccess(role) { return FULL_ACCESS_ROLES.includes(norm(role)); }
function isLimited(role) { return LIMITED_ROLES.includes(norm(role)); }

async function loadDocAndAttachProject(req, res, next) {
  try {
    const tenantKey = req.tenantKey;
    const docId = req.params.id;
    const doc = await Document.findOne({ _id: docId, tenantKey }).lean();
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });
    req.params.docId = docId;
    req.params.id = doc.projectId;
    next();
  } catch (e) {
    console.error('[documents.loadDocAndAttachProject] error:', e);
    res.status(500).json({ error: e.message });
  }
}

function safeOid(id) {
  try { return new mongoose.Types.ObjectId(id); }
  catch { return null; }
}

function escapeRegex(s = '') {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildDocsQuery(req) {
  const role = norm(req.user?.role);
  const and = [{ tenantKey: req.tenantKey }];

  // --- Filtros básicos ---
  const category = (req.query.category || '').trim();
  if (category) and.push({ category });

  if (req.query.projectId) {
    const pid = safeOid(String(req.query.projectId));
    if (pid) and.push({ $or: [{ projectId: pid }, { project: pid }] });
    else and.push({ _id: { $exists: false } });
  }

  // ✅ NUEVO: filtro por permitCode
  const permitCode = (req.query.permitCode || '').trim();
  if (permitCode) {
    and.push({ permitCode });
  }

  if (req.query.unitId) {
    const uid = safeOid(String(req.query.unitId));
    if (uid) and.push({ unitId: uid });
    else and.push({ _id: { $exists: false } });
  }

  if (req.query.checklistId) {
    const cid = safeOid(String(req.query.checklistId));
    if (cid) {
      if (category && category === 'beforeAfter') {
        and.push({ $or: [{ checklistId: cid }, { category: 'beforeAfter' }] });
      } else {
        and.push({ $or: [{ checklistId: cid }, { checklist: cid }] });
      }
    } else {
      and.push({ _id: { $exists: false } });
    }
  }

  // --- Búsqueda libre (?q=...)
  const qraw = (req.query.q || '').trim();
  if (qraw) {
    const rx = new RegExp(escapeRegex(qraw), 'i');
    and.push({
      $or: [
        { originalname: rx },
        { title: rx },
        { filename: rx },
        { unitTag: rx },
        { mimetype: rx }
      ]
    });
  }

  // --- ACL por rol ---
  if (isFullAccess(role)) {
    // ven todo
  } else if (role === 'commercial') {
    and.push({ unitId: { $exists: true, $ne: null } });
    and.push({
      $or: [
        { visibleToRoles: role },
        { visibleToRoles: { $exists: false } },
        { visibleToRoles: { $size: 0 } }
      ]
    });
  } else if (role === 'tecnico' || role === 'legal') {
    and.push({
      $or: [
        { visibleToRoles: role },
        { category: 'permits' }
      ]
    });
  } else if (isLimited(role)) {
    and.push({
      $or: [
        { visibleToRoles: role },
        { visibleToRoles: { $exists: false } },
        { visibleToRoles: { $size: 0 } }
      ]
    });
  } else {
    and.push({ _id: { $exists: false } });
  }

  return and.length === 1 ? and[0] : { $and: and };
}

/* =========================================================================
   SUBIDA DE DOCUMENTOS
   ========================================================================= */
function attachProjectIdParam(req, _res, next) {
  const pid = req.body?.projectId || req.query?.projectId;
  req.params = req.params || {};
  if (pid) {
    if (req.params.id && req.params.id !== pid) req.params.docId = req.params.id;
    req.params.id = pid;
  }
  next();
}

async function deleteDocHandler(req, res) {
  try {
    const role = norm(req.user?.role);
    const tenantKey = req.tenantKey;
    const docId = req.params.docId || req.params.id;

    const pin = (req.body?.pin || req.query?.pin || '').toString().trim();
    const expectedPin = process.env.DELETE_DOCS_PIN || '2580';
    if (!isFullAccess(role)) {
      if (pin !== expectedPin) {
        return res.status(403).json({ error: 'pin_invalid' });
      }
    }

    const doc = await Document.findOne({ _id: docId, tenantKey }).lean();
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

    await Document.deleteOne({ _id: docId, tenantKey });

    const absPath = path.isAbsolute(doc.path) ? doc.path : path.join(__dirname, '..', doc.path);
    if (fs.existsSync(absPath)) {
      try { fs.unlinkSync(absPath); } catch {}
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('[documents.delete] error:', e);
    res.status(500).json({ error: e.message });
  }
}

router.post(
  '/upload',
  multiUpload,
  attachProjectIdParam,
  requireRole('admin','bank','promoter','gerencia','socios','financiero','contable','legal','tecnico','commercial'),
  requireProjectAccess({ commercialOnlySales: false }),
  async (req, res) => {
    try {
      const tenantKey    = req.tenantKey;
      const uploaderRole = (req.user?.role || '').toLowerCase();
      const userId       = req.user?.userId || req.user?._id;

      const projectId   = (req.body?.projectId || req.query?.projectId || req.params?.id || '').toString();
      const checklistId = req.body?.checklistId || req.query?.checklistId || null;
      const unitId      = req.body?.unitId      || req.query?.unitId      || null;

      // ✅ NUEVO: permitCode/permitTitle
      const permitCode  = (req.body?.permitCode || req.query?.permitCode || '').trim() || undefined;
      const permitTitle = (req.body?.permitTitle || req.query?.permitTitle || '').trim() || undefined;

      const categoryRaw = (req.body?.category || req.query?.category || '').trim();
      const baTagRaw    = (req.body?.baTag    || req.query?.baTag    || '').toUpperCase().trim();
      const category    = categoryRaw || undefined;
      const baTag       = (baTagRaw === 'BEFORE' || baTagRaw === 'AFTER') ? baTagRaw : undefined;

      let   { expiryDate, visibleToRoles } = req.body || {};

      if (!tenantKey)  return res.status(400).json({ error: 'Falta tenantKey' });
      if (!projectId)  return res.status(400).json({ error: 'Falta projectId' });

      const proj = await Project.findOne({ _id: projectId, tenantKey }).select('_id').lean();
      if (!proj) return res.status(404).json({ error: 'project_not_found' });

      // Fecha de expiración (opcional)
      let expiry = null;
      if (expiryDate) {
        const d = new Date(expiryDate);
        if (!isNaN(d.getTime())) expiry = d;
      }

      // ---- ACL ----
      const nrm = s => (s || '').toString().toLowerCase().trim();
      const FULL   = ['admin','bank','promoter','gerencia','socios','financiero','contable'];
      const LIMITED= ['legal','tecnico','commercial'];

      let acl = Array.isArray(visibleToRoles)
        ? visibleToRoles.map(nrm).filter(Boolean)
        : (typeof visibleToRoles === 'string' && visibleToRoles.trim()
            ? visibleToRoles.split(',').map(nrm).filter(Boolean)
            : null);

      if (checklistId && (!acl || !acl.length)) {
        const cl = await ProjectChecklist
          .findOne({ _id: checklistId, projectId })
          .select('roleOwner visibleToRoles')
          .lean();
        if (cl) {
          const inherited = [
            ...(Array.isArray(cl.visibleToRoles) ? cl.visibleToRoles.map(nrm) : []),
            nrm(cl.roleOwner)
          ];
          acl = Array.from(new Set([...inherited, ...FULL]));
        }
      }

      if ((!acl || !acl.length) && unitId) {
        acl = Array.from(new Set(['commercial', ...FULL]));
      }

      const isPermits = (category || '').toLowerCase() === 'permits';
      if ((!acl || !acl.length) && isPermits) {
        acl = Array.from(new Set(['tecnico','legal', ...FULL]));
      }

      if (!acl || !acl.length) {
        const role = nrm(uploaderRole);
        acl = LIMITED.includes(role) ? Array.from(new Set([role, ...FULL])) : FULL;
      }

      // ---- Unidad (opcional) ----
      let unitOid = null, unitTag = null;
      if (unitId) {
        unitOid = safeOid(String(unitId));
        if (!unitOid) return res.status(400).json({ error: 'unitId inválido' });
        const u = await Unit.findOne({ _id: unitOid, projectId }).select('manzana lote').lean();
        if (u) unitTag = `${u.manzana || '-'}-${u.lote || ''}`;
      }

      // ---- Archivos ----
      const files =
        (req.files && req.files.files) ||
        (req.files && req.files.file)  ||
        (req.file ? [req.file] : []);

      if (!files || !files.length) {
        return res.status(400).json({ error: 'Falta archivo(s)' });
      }

      const created = [];
      for (const f of files) {
        const doc = await Document.create({
          tenantKey,
          projectId: new mongoose.Types.ObjectId(projectId),

          // ✅ Guardamos el vínculo con el trámite
          permitCode: permitCode || undefined,
          permitTitle: permitTitle || undefined,

          checklistId: checklistId ? new mongoose.Types.ObjectId(checklistId) : undefined,
          unitId: unitOid || undefined,
          unitTag: unitTag || undefined,

          originalname: f.originalname,
          filename:     f.filename,
          path:         `uploads/${f.filename}`,
          mimetype:     f.mimetype,
          size:         f.size,

          expiryDate:   expiry,
          uploadedBy:   userId,
          uploaderRole: uploaderRole,
          visibleToRoles: acl,

          category,
          baTag,
          tag: baTag
        });
        created.push(doc.toObject());
      }

      res.status(201).json(created);
    } catch (e) {
      console.error('[documents.upload] error:', e);
      res.status(500).json({ error: 'upload_failed', message: e.message });
    }
  }
);

/* =========================================================================
   LISTADO DE DOCUMENTOS
   ========================================================================= */
router.get('/', async (req, res) => {
  try {
    const q = buildDocsQuery(req);
    const list = await Document.find(q).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (e) {
    console.error('[documents.list] error:', e);
    res.status(500).json({ error: e.message });
  }
});

/* =========================================================================
   Descargar
   ========================================================================= */
router.get('/:id/download', async (req, res) => {
  try {
    const role = norm(req.user?.role);
    const doc = await Document.findOne({ _id: req.params.id, tenantKey: req.tenantKey }).lean();
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

    if (!isFullAccess(role)) {
      const acl = (doc.visibleToRoles || []).map(norm);
      if (acl.length && !acl.includes(role)) {
        return res.status(403).json({ error: 'No tienes permiso para este documento' });
      }
    }

    const absPath = path.isAbsolute(doc.path) ? doc.path : path.join(__dirname, '..', doc.path);
    if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'Archivo no existe en servidor' });

    res.download(absPath, doc.originalname || path.basename(absPath));
  } catch (e) {
    console.error('[documents.download] error:', e);
    res.status(500).json({ error: e.message });
  }
});

/* =========================================================================
   Borrado
   ========================================================================= */
async function deleteDocHandler(req, res) {
  try {
    const role = norm(req.user?.role);
    const tenantKey = req.tenantKey;
    const docId = req.params.docId || req.params.id;

    const pin = (req.body?.pin || req.query?.pin || '').toString().trim();
    const expectedPin = process.env.DELETE_DOCS_PIN || '2580';
    if (!isFullAccess(role)) {
      if (pin !== expectedPin) {
        return res.status(403).json({ error: 'pin_invalid' });
      }
    }

    const doc = await Document.findOne({ _id: docId, tenantKey }).lean();
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

    await Document.deleteOne({ _id: docId, tenantKey });

    const absPath = path.isAbsolute(doc.path) ? doc.path : path.join(__dirname, '..', doc.path);
    if (fs.existsSync(absPath)) {
      try { fs.unlinkSync(absPath); } catch {}
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('[documents.delete] error:', e);
    res.status(500).json({ error: e.message });
  }
}

router.delete(
  '/:id',
  requireRole('admin','bank','promoter','gerencia','socios','financiero','contable','legal','tecnico','commercial'),
  loadDocAndAttachProject,
  requireProjectAccess({ commercialOnlySales: false }),
  deleteDocHandler
);

router.post(
  '/:id/delete',
  requireRole('admin','bank','promoter','gerencia','socios','financiero','contable','legal','tecnico','commercial'),
  loadDocAndAttachProject,
  requireProjectAccess({ commercialOnlySales: false }),
  deleteDocHandler
);

module.exports = router;
