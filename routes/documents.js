// routes/documents.js
const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const mongoose = require('mongoose');

const {
  requireRole,
  requireProjectAccess,
  visibleDocDepartments,
  canAccessDocDepartment
} = require('../middleware/rbac');

const Document = require('../models/Document');
const Project = require('../models/Project');
const ProjectChecklist = require('../models/ProjectChecklist');
const Unit = require('../models/Unit');
const UnitDocFolder = require('../models/UnitDocFolder');

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
const multiUpload = upload.fields([
  { name: 'files', maxCount: 20 },
  { name: 'file', maxCount: 1 }
]);

/* =========================
   Helpers
   ========================= */
function norm(s) {
  return (s || '').toString().toLowerCase().trim();
}

const FULL_ACCESS_ROLES = [
  'admin',
  'bank',
  'promoter',
  'gerencia',
  'socios',
  'financiero',
  'contable'
];

const LIMITED_ROLES = ['legal', 'tecnico', 'commercial'];

function isFullAccess(role) {
  return FULL_ACCESS_ROLES.includes(norm(role));
}

function isLimited(role) {
  return LIMITED_ROLES.includes(norm(role));
}

function safeOid(id) {
  try {
    if (!mongoose.Types.ObjectId.isValid(String(id || ''))) return null;
    return new mongoose.Types.ObjectId(id);
  } catch {
    return null;
  }
}

function escapeRegex(s = '') {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getUserId(req) {
  return req.user?.userId || req.user?._id || req.user?.id;
}

function getTenantKey(req) {
  return (
    req.tenantKey ||
    req.tenant?.key ||
    req.tenant?.tenantKey ||
    req.user?.tenantKey ||
    req.headers['x-tenant-key'] ||
    req.headers['x-tenant']
  );
}

async function loadDocAndAttachProject(req, res, next) {
  try {
    const tenantKey = getTenantKey(req);
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

function getRequestedDepartment(req) {
  return norm(req.body?.department || req.query?.department || '');
}

function getRequestedFolderId(req) {
  const raw = req.body?.folderId ?? req.query?.folderId ?? '';
  const s = String(raw || '').trim();

  if (!s || s === 'null' || s === 'undefined') return null;

  return s;
}

async function validateFolderAccess({ req, projectId, unitId, department, folderId }) {
  if (!folderId) return null;

  const folderOid = safeOid(folderId);
  if (!folderOid) {
    const err = new Error('folderId inválido');
    err.status = 400;
    throw err;
  }

  const tenantKey = getTenantKey(req);

  const folder = await UnitDocFolder.findOne({
    _id: folderOid,
    tenantKey,
    projectId,
    unitId,
    department
  }).lean();

  if (!folder) {
    const err = new Error('Carpeta no encontrada para esta unidad/departamento');
    err.status = 404;
    throw err;
  }

  return folder._id;
}

function buildDocsQuery(req) {
  const role = norm(req.user?.role);
  const tenantKey = getTenantKey(req);
  const and = [{ tenantKey }];

  const category = (req.query.category || '').trim();
  if (category) and.push({ category });

  if (req.query.projectId) {
    const pid = safeOid(String(req.query.projectId));
    if (pid) and.push({ $or: [{ projectId: pid }, { project: pid }] });
    else and.push({ _id: { $exists: false } });
  }

  const permitCode = (req.query.permitCode || '').trim();
  if (permitCode) and.push({ permitCode });

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

  // ✅ NUEVO: filtro por departamento documental
  const allowedDepartments = visibleDocDepartments(role);
  const requestedDepartment = norm(req.query.department);

  if (requestedDepartment) {
    if (!allowedDepartments.includes(requestedDepartment)) {
      and.push({ _id: { $exists: false } });
    } else {
      and.push({ department: requestedDepartment });
    }
  } else if (allowedDepartments.length && req.query.unitId) {
    // En docs de unidad filtramos por lo que puede ver el rol.
    // Compatibilidad: documentos antiguos sin department se consideran commercial.
    and.push({
      $or: [
        { department: { $in: allowedDepartments } },
        ...(allowedDepartments.includes('commercial')
          ? [{ department: { $exists: false } }, { department: null }]
          : [])
      ]
    });
  }

  // ✅ NUEVO: filtro por subcarpeta
  if ('folderId' in req.query) {
    const folderId = getRequestedFolderId(req);

    if (!folderId) {
      and.push({
        $or: [
          { folderId: null },
          { folderId: { $exists: false } }
        ]
      });
    } else {
      const fid = safeOid(folderId);
      if (fid) and.push({ folderId: fid });
      else and.push({ _id: { $exists: false } });
    }
  }

  const qraw = (req.query.q || '').trim();
  if (qraw) {
    const rx = new RegExp(escapeRegex(qraw), 'i');

    and.push({
      $or: [
        { originalname: rx },
        { title: rx },
        { filename: rx },
        { unitTag: rx },
        { mimetype: rx },
        { permitCode: rx },
        { permitTitle: rx }
      ]
    });
  }

  // --- ACL por rol legacy + compatibilidad ---
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
        { category: 'permits' },
        { unitId: { $exists: true, $ne: null } }
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

router.post(
  '/upload',
  multiUpload,
  attachProjectIdParam,
  requireRole(
    'admin',
    'bank',
    'promoter',
    'gerencia',
    'socios',
    'financiero',
    'contable',
    'legal',
    'tecnico',
    'commercial'
  ),
  requireProjectAccess({ commercialOnlySales: false }),
  async (req, res) => {
    try {
      const tenantKey = getTenantKey(req);
      const uploaderRole = norm(req.user?.role);
      const userId = getUserId(req);

      const projectId = (req.body?.projectId || req.query?.projectId || req.params?.id || '').toString();
      const checklistId = req.body?.checklistId || req.query?.checklistId || null;
      const unitId = req.body?.unitId || req.query?.unitId || null;

      const permitCode = (req.body?.permitCode || req.query?.permitCode || '').trim() || undefined;
      const permitTitle = (req.body?.permitTitle || req.query?.permitTitle || '').trim() || undefined;

      const replacesRaw = (req.body?.replaces || req.query?.replaces || '').toString().trim();
      const replacesOid = replacesRaw ? safeOid(replacesRaw) : null;

      if (replacesRaw && !replacesOid) {
        return res.status(400).json({ error: 'replaces inválido' });
      }

      const categoryRaw = (req.body?.category || req.query?.category || '').trim();
      const baTagRaw = (req.body?.baTag || req.query?.baTag || '').toUpperCase().trim();

      const category = categoryRaw || undefined;
      const baTag = (baTagRaw === 'BEFORE' || baTagRaw === 'AFTER') ? baTagRaw : undefined;

      let { expiryDate, visibleToRoles } = req.body || {};

      if (!tenantKey) return res.status(400).json({ error: 'Falta tenantKey' });
      if (!projectId) return res.status(400).json({ error: 'Falta projectId' });

      const projectOid = safeOid(projectId);
      if (!projectOid) return res.status(400).json({ error: 'projectId inválido' });

      const proj = await Project.findOne({ _id: projectOid, tenantKey }).select('_id').lean();
      if (!proj) return res.status(404).json({ error: 'project_not_found' });

      let expiry = null;
      if (expiryDate) {
        const d = new Date(expiryDate);
        if (!isNaN(d.getTime())) expiry = d;
      }

      // ---- Unidad opcional ----
      let unitOid = null;
      let unitTag = null;

      if (unitId) {
        unitOid = safeOid(String(unitId));
        if (!unitOid) return res.status(400).json({ error: 'unitId inválido' });

        const u = await Unit
          .findOne({ _id: unitOid, projectId: projectOid })
          .select('manzana lote')
          .lean();

        if (!u) return res.status(404).json({ error: 'unit_not_found' });

        unitTag = `${u.manzana || '-'}-${u.lote || ''}`;
      }

      // ✅ NUEVO: department/folder para docs de unidad
      let department = getRequestedDepartment(req);
      let folderId = getRequestedFolderId(req);
      let folderOid = null;

      if (unitOid) {
        // Si no viene departamento, por defecto commercial para compatibilidad
        department = department || 'commercial';

        if (!canAccessDocDepartment(req, department)) {
          return res.status(403).json({
            error: 'No puedes subir documentos en esta carpeta documental'
          });
        }

        folderOid = await validateFolderAccess({
          req,
          projectId: projectOid,
          unitId: unitOid,
          department,
          folderId
        });
      } else {
        // Docs no asociados a unidad mantienen comportamiento anterior
        department = undefined;
        folderId = null;
      }

      // ---- ACL ----
      const FULL = ['admin', 'bank', 'promoter', 'gerencia', 'socios', 'financiero', 'contable'];
      const LIMITED = ['legal', 'tecnico', 'commercial'];

      let acl = Array.isArray(visibleToRoles)
        ? visibleToRoles.map(norm).filter(Boolean)
        : (typeof visibleToRoles === 'string' && visibleToRoles.trim()
          ? visibleToRoles.split(',').map(norm).filter(Boolean)
          : null);

      if (checklistId && (!acl || !acl.length)) {
        const cl = await ProjectChecklist
          .findOne({ _id: checklistId, projectId: projectOid })
          .select('roleOwner visibleToRoles')
          .lean();

        if (cl) {
          const inherited = [
            ...(Array.isArray(cl.visibleToRoles) ? cl.visibleToRoles.map(norm) : []),
            norm(cl.roleOwner)
          ];

          acl = Array.from(new Set([...inherited, ...FULL]));
        }
      }

      // ✅ Docs de unidad heredan ACL según departamento
      if ((!acl || !acl.length) && unitOid) {
        if (department === 'commercial') acl = Array.from(new Set(['commercial', ...FULL, 'legal']));
        else if (department === 'tecnico') acl = Array.from(new Set(['tecnico', ...FULL, 'legal']));
        else if (department === 'legal') acl = Array.from(new Set(['legal', ...FULL]));
        else acl = Array.from(new Set(['commercial', ...FULL]));
      }

      const isPermits = (category || '').toLowerCase() === 'permits';

      if ((!acl || !acl.length) && isPermits) {
        acl = Array.from(new Set(['tecnico', 'legal', ...FULL]));
      }

      if (!acl || !acl.length) {
        const role = norm(uploaderRole);
        acl = LIMITED.includes(role) ? Array.from(new Set([role, ...FULL])) : FULL;
      }

      // ---- Archivos ----
      const files =
        (req.files && req.files.files) ||
        (req.files && req.files.file) ||
        (req.file ? [req.file] : []);

      if (!files || !files.length) {
        return res.status(400).json({ error: 'Falta archivo(s)' });
      }

      let replacedDoc = null;

      if (replacesOid) {
        replacedDoc = await Document.findOne({ _id: replacesOid, tenantKey }).lean();

        if (!replacedDoc) {
          return res.status(404).json({ error: 'doc_to_replace_not_found' });
        }

        if (String(replacedDoc.projectId) !== String(projectOid)) {
          return res.status(400).json({ error: 'replaces_not_same_project' });
        }

        if (replacedDoc.department && !canAccessDocDepartment(req, replacedDoc.department)) {
          return res.status(403).json({ error: 'No puedes reemplazar este documento' });
        }
      }

      const created = [];

      for (const f of files) {
        const doc = await Document.create({
          tenantKey,
          projectId: projectOid,

          permitCode,
          permitTitle,

          checklistId: checklistId ? new mongoose.Types.ObjectId(checklistId) : undefined,
          unitId: unitOid || undefined,
          unitTag: unitTag || undefined,

          department: department || undefined,
          folderId: folderOid || null,

          originalname: f.originalname,
          filename: f.filename,
          path: `uploads/${f.filename}`,
          mimetype: f.mimetype,
          size: f.size,

          expiryDate: expiry,

          uploadedBy: userId,
          uploaderRole,
          visibleToRoles: acl,

          category,
          baTag,
          tag: baTag,

          status: 'ACTIVE',
          replaces: replacesOid || undefined
        });

        if (replacesOid) {
          await Document.updateOne(
            { _id: replacesOid, tenantKey },
            { $set: { status: 'REPLACED', replacedBy: doc._id } }
          );
        }

        created.push(doc.toObject());
      }

      res.status(201).json(created);
    } catch (e) {
      console.error('[documents.upload] error:', e);
      res.status(e.status || 500).json({
        error: e.status ? e.message : 'upload_failed',
        message: e.message
      });
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
   Marcar como CUMPLIDO
   ========================================================================= */
router.patch(
  '/:id/complete',
  requireRole(
    'admin',
    'bank',
    'promoter',
    'gerencia',
    'socios',
    'financiero',
    'contable',
    'legal',
    'tecnico',
    'commercial'
  ),
  loadDocAndAttachProject,
  requireProjectAccess({ commercialOnlySales: false }),
  async (req, res) => {
    try {
      const tenantKey = getTenantKey(req);
      const docId = req.params.docId || req.params.id;

      const note = (req.body?.note || '').toString().trim();
      const userId = getUserId(req);

      const doc = await Document.findOne({ _id: docId, tenantKey });
      if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

      if (doc.department && !canAccessDocDepartment(req, doc.department)) {
        return res.status(403).json({ error: 'No tienes permiso para este documento' });
      }

      const st = String(doc.status || 'ACTIVE').toUpperCase();
      if (st === 'REPLACED') return res.status(400).json({ error: 'doc_replaced' });

      doc.status = 'COMPLETED';
      doc.completedAt = new Date();
      doc.completedBy = userId;
      doc.completionNote = note || undefined;

      await doc.save();

      res.json({ ok: true });
    } catch (e) {
      console.error('[documents.complete] error:', e);
      res.status(500).json({ error: e.message });
    }
  }
);

/* =========================================================================
   Descargar
   ========================================================================= */
router.get('/:id/download', async (req, res) => {
  try {
    const role = norm(req.user?.role);
    const tenantKey = getTenantKey(req);

    const doc = await Document.findOne({ _id: req.params.id, tenantKey }).lean();
    if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

    if (doc.department && !canAccessDocDepartment(req, doc.department)) {
      return res.status(403).json({ error: 'No tienes permiso para este documento' });
    }

    if (!isFullAccess(role)) {
      const acl = (doc.visibleToRoles || []).map(norm);

      if (acl.length && !acl.includes(role)) {
        return res.status(403).json({ error: 'No tienes permiso para este documento' });
      }
    }

    const absPath = path.isAbsolute(doc.path) ? doc.path : path.join(__dirname, '..', doc.path);

    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ error: 'Archivo no existe en servidor' });
    }

    res.download(absPath, doc.originalname || path.basename(absPath));
  } catch (e) {
    console.error('[documents.download] error:', e);
    res.status(500).json({ error: e.message });
  }
});

/* =========================================================================
   Borrado con PIN
   ========================================================================= */
async function deleteDocHandler(req, res) {
  try {
    const role = norm(req.user?.role);
    const tenantKey = getTenantKey(req);
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

    if (doc.department && !canAccessDocDepartment(req, doc.department)) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar este documento' });
    }

    await Document.deleteOne({ _id: docId, tenantKey });

    const absPath = path.isAbsolute(doc.path) ? doc.path : path.join(__dirname, '..', doc.path);

    if (fs.existsSync(absPath)) {
      try {
        fs.unlinkSync(absPath);
      } catch {}
    }

    res.json({ ok: true });
  } catch (e) {
    console.error('[documents.delete] error:', e);
    res.status(500).json({ error: e.message });
  }
}

router.delete(
  '/:id',
  requireRole(
    'admin',
    'bank',
    'promoter',
    'gerencia',
    'socios',
    'financiero',
    'contable',
    'legal',
    'tecnico',
    'commercial'
  ),
  loadDocAndAttachProject,
  requireProjectAccess({ commercialOnlySales: false }),
  deleteDocHandler
);

router.post(
  '/:id/delete',
  requireRole(
    'admin',
    'bank',
    'promoter',
    'gerencia',
    'socios',
    'financiero',
    'contable',
    'legal',
    'tecnico',
    'commercial'
  ),
  loadDocAndAttachProject,
  requireProjectAccess({ commercialOnlySales: false }),
  deleteDocHandler
);

module.exports = router;