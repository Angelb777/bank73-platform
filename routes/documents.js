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
const User = require('../models/User');
const ProjectDocFolderPermission = require('../models/ProjectDocFolderPermission');
const { PROJECT_DOC_FOLDERS } = ProjectDocFolderPermission;
const audit = require('../utils/audit');

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

function getRequestedProjectFolder(req) {
  const raw = req.body?.folder ?? req.body?.carpeta ?? req.query?.folder ?? req.query?.carpeta ?? '';
  const s = norm(raw);
  const aliases = {
    technical: 'tecnico',
    tecnico: 'tecnico',
    comercial: 'comercial',
    commercial: 'comercial',
    financiero: 'financiero',
    finance: 'financiero',
    legal: 'legal',
    gerencia: 'gerencia',
    management: 'gerencia'
  };

  return aliases[s] || '';
}

function getRequestedSubfolder(req) {
  return String(req.body?.subfolder ?? req.body?.subcarpeta ?? req.query?.subfolder ?? req.query?.subcarpeta ?? '').trim();
}

function getUserId(req) {
  return req.user?.userId || req.user?._id || req.user?.id || null;
}

function isProjectFolderManager(req) {
  return ['admin', 'promoter'].includes(norm(req.user?.role));
}

function canMoveProjectDocs(req) {
  return ['admin', 'bank', 'promoter'].includes(norm(req.user?.role));
}

function includesId(list, id) {
  const s = String(id || '');
  return Array.isArray(list) && list.some(v => String(v) === s);
}

function uniqueIds(lists) {
  const out = [];
  const seen = new Set();

  for (const list of lists || []) {
    for (const value of (Array.isArray(list) ? list : [])) {
      const s = String(value || '');
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(value);
    }
  }

  return out;
}

function getProjectAssignedUserIds(project) {
  const ass = project?.assignees || {};
  return uniqueIds([
    project?.assignedUsers,
    project?.teamUsers,
    project?.members,
    project?.assignedPromoters,
    project?.assignedCommercials,
    project?.assignedLegal,
    project?.assignedTecnicos,
    project?.assignedGerencia,
    project?.assignedSocios,
    project?.assignedFinanciero,
    project?.assignedContable,
    ass.promoter,
    ass.commercial,
    ass.legal,
    ass.tecnico,
    ass.gerencia,
    ass.socios,
    ass.financiero,
    ass.contable
  ]);
}

function fallbackFolderUsers(project, folder) {
  const ass = project?.assignees || {};
  const map = {
    tecnico: [project?.assignedTecnicos, ass.tecnico],
    comercial: [project?.assignedCommercials, ass.commercial],
    financiero: [project?.assignedFinanciero, project?.assignedContable, ass.financiero, ass.contable],
    legal: [project?.assignedLegal, ass.legal],
    gerencia: [project?.assignedGerencia, project?.assignedSocios, ass.gerencia, ass.socios]
  };

  return uniqueIds(map[folder] || []);
}

function effectiveProjectFolder(doc) {
  const f = norm(doc?.folder);
  if (PROJECT_DOC_FOLDERS.includes(f)) return f;
  return 'gerencia';
}

function inferProjectFolder(req, department, category) {
  const requested = getRequestedProjectFolder(req);
  if (requested) return requested;

  const dep = norm(department);
  if (dep === 'commercial') return 'comercial';
  if (dep === 'tecnico') return 'tecnico';
  if (dep === 'legal') return 'legal';

  const cat = norm(category);
  if (cat === 'beforeafter' || cat === 'avances' || cat === 'tecnico') return 'tecnico';
  if (cat === 'permits' || cat === 'permisos') return 'legal';
  if (cat === 'finanzas' || cat === 'finance' || cat === 'financiero') return 'financiero';
  if (cat === 'legal') return 'legal';
  if (cat === 'commercial' || cat === 'comercial') return 'comercial';

  return 'gerencia';
}

function projectFolderFromChecklistRole(roleRaw) {
  const role = norm(roleRaw);
  if (role === 'tecnico') return 'tecnico';
  if (role === 'legal') return 'legal';
  if (role === 'commercial' || role === 'comercial') return 'comercial';
  if (role === 'financiero' || role === 'contable') return 'financiero';
  if (role === 'gerencia' || role === 'socios') return 'gerencia';
  return '';
}

async function getProjectFolderPermissions({ tenantKey, project }) {
  const records = await ProjectDocFolderPermission
    .find({ tenantKey, projectId: project._id })
    .lean();

  const byFolder = new Map(records.map(r => [r.folder, r]));

  return PROJECT_DOC_FOLDERS.map(folder => {
    const record = byFolder.get(folder);
    return {
      folder,
      assignedUsers: record ? (record.assignedUsers || []) : fallbackFolderUsers(project, folder),
      subfolders: record ? (record.subfolders || []) : [],
      explicit: !!record
    };
  });
}

async function getAllowedProjectFolders(req, project) {
  if (isProjectFolderManager(req) || norm(req.user?.role) === 'bank') return PROJECT_DOC_FOLDERS.slice();

  const userId = getUserId(req);
  if (!userId) return [];

  const perms = await getProjectFolderPermissions({
    tenantKey: getTenantKey(req),
    project
  });

  return perms
    .filter(p => includesId(p.assignedUsers, userId))
    .map(p => p.folder);
}

function projectFolderMongoFilter(folders) {
  const allowed = (folders || []).filter(f => PROJECT_DOC_FOLDERS.includes(f));
  const or = [];

  if (allowed.length) or.push({ folder: { $in: allowed } });
  if (allowed.includes('gerencia')) {
    or.push({ folder: { $exists: false } }, { folder: null }, { folder: '' });
  }

  return or.length ? { $or: or } : { _id: { $exists: false } };
}

async function canAccessProjectDoc(req, doc) {
  if (!doc?.projectId) return true;
  if (isProjectFolderManager(req) || norm(req.user?.role) === 'bank') return true;

  const project = await Project.findOne({
    _id: doc.projectId,
    tenantKey: getTenantKey(req)
  }).lean();
  if (!project) return false;

  const allowed = await getAllowedProjectFolders(req, project);
  return allowed.includes(effectiveProjectFolder(doc));
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

async function buildDocsQuery(req) {
  const role = norm(req.user?.role);
  const tenantKey = getTenantKey(req);
  const and = [{ tenantKey }];
  let projectOid = null;
  let projectForFolderAccess = null;

  const category = (req.query.category || '').trim();
  if (category) and.push({ category });

  if (req.query.projectId) {
    const pid = safeOid(String(req.query.projectId));
    if (pid) {
      projectOid = pid;
      and.push({ $or: [{ projectId: pid }, { project: pid }] });
    }
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

  const isProjectRepositoryQuery = !!projectOid &&
    !req.query.unitId &&
    !req.query.checklistId &&
    !category &&
    !permitCode &&
    !req.query.department;

  if (projectOid && (isProjectRepositoryQuery || 'folder' in req.query || 'carpeta' in req.query || 'subfolder' in req.query || 'subcarpeta' in req.query)) {
    projectForFolderAccess = await Project.findOne({ _id: projectOid, tenantKey }).lean();

    if (!projectForFolderAccess) {
      and.push({ _id: { $exists: false } });
    } else {
      let allowedFolders = await getAllowedProjectFolders(req, projectForFolderAccess);
      const requestedFolder = getRequestedProjectFolder(req);

      if (requestedFolder) {
        allowedFolders = allowedFolders.includes(requestedFolder) ? [requestedFolder] : [];
      }

      and.push(projectFolderMongoFilter(allowedFolders));

      const requestedSubfolder = getRequestedSubfolder(req);
      if ('subfolder' in req.query || 'subcarpeta' in req.query) {
        if (requestedSubfolder) and.push({ subfolder: requestedSubfolder });
        else and.push({ $or: [{ subfolder: '' }, { subfolder: null }, { subfolder: { $exists: false } }] });
      }
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
  if (isProjectRepositoryQuery) {
    // El repositorio documental del proyecto se filtra por carpeta, no por ACL legacy.
  } else if (isFullAccess(role)) {
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

router.get(
  '/folder-permissions',
  attachProjectIdParam,
  requireRole('admin', 'bank', 'promoter', 'gerencia', 'socios', 'financiero', 'contable', 'legal', 'tecnico', 'commercial'),
  requireProjectAccess({ commercialOnlySales: false }),
  async (req, res) => {
    try {
      const tenantKey = getTenantKey(req);
      const projectOid = safeOid(String(req.query.projectId || req.params.id || ''));
      if (!projectOid) return res.status(400).json({ error: 'projectId inválido' });

      const project = await Project.findOne({ _id: projectOid, tenantKey }).lean();
      if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

      const assignedIds = getProjectAssignedUserIds(project);
      const projectUsers = assignedIds.length
        ? await User.find({ tenantKey, _id: { $in: assignedIds } })
            .select('_id name email role status')
            .sort({ role: 1, name: 1, email: 1 })
            .lean()
        : [];

      const permissions = await getProjectFolderPermissions({ tenantKey, project });
      const allowedFolders = await getAllowedProjectFolders(req, project);

      res.json({
        folders: permissions
          .filter(p => allowedFolders.includes(p.folder))
          .map(p => ({
            folder: p.folder,
            assignedUsers: (p.assignedUsers || []).map(String),
            subfolders: p.subfolders || [],
            explicit: p.explicit
          })),
        projectUsers,
        canManage: isProjectFolderManager(req),
        canMove: canMoveProjectDocs(req),
        canSearchAll: ['admin', 'bank', 'promoter'].includes(norm(req.user?.role))
      });
    } catch (e) {
      console.error('[documents.folder-permissions.list] error:', e);
      res.status(500).json({ error: e.message });
    }
  }
);

router.patch(
  '/folder-permissions/:folder',
  attachProjectIdParam,
  requireRole('admin', 'promoter'),
  requireProjectAccess({ commercialOnlySales: false }),
  async (req, res) => {
    try {
      const tenantKey = getTenantKey(req);
      const projectOid = safeOid(String(req.body?.projectId || req.query.projectId || req.params.id || ''));
      const folder = norm(req.params.folder);

      if (!projectOid) return res.status(400).json({ error: 'projectId inválido' });
      if (!PROJECT_DOC_FOLDERS.includes(folder)) return res.status(400).json({ error: 'folder inválida' });

      const project = await Project.findOne({ _id: projectOid, tenantKey }).lean();
      if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

      const projectUserIds = getProjectAssignedUserIds(project).map(String);
      const requested = Array.isArray(req.body?.assignedUsers) ? req.body.assignedUsers.map(String) : [];
      const invalid = requested.filter(uid => !projectUserIds.includes(uid));
      if (invalid.length) {
        return res.status(400).json({ error: 'Solo se pueden asignar usuarios ya asignados al proyecto' });
      }

      const assignedUsers = requested
        .filter(uid => mongoose.Types.ObjectId.isValid(uid))
        .map(uid => new mongoose.Types.ObjectId(uid));

      const permission = await ProjectDocFolderPermission.findOneAndUpdate(
        { tenantKey, projectId: projectOid, folder },
        { $set: { assignedUsers } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      ).lean();

      await audit(req, 'document.folder_permissions.updated', {
        targetType: 'project',
        targetId: projectOid,
        projectId: projectOid,
        message: 'Permisos de carpeta documental actualizados',
        metadata: { folder, assignedUsers: assignedUsers.map(String) }
      });

      res.json({ ok: true, folder: permission.folder, assignedUsers: permission.assignedUsers || [] });
    } catch (e) {
      console.error('[documents.folder-permissions.update] error:', e);
      res.status(500).json({ error: e.message });
    }
  }
);

router.post(
  '/folder-permissions/:folder/subfolders',
  attachProjectIdParam,
  requireRole('admin', 'bank', 'promoter', 'gerencia', 'socios', 'financiero', 'contable', 'legal', 'tecnico', 'commercial'),
  requireProjectAccess({ commercialOnlySales: false }),
  async (req, res) => {
    try {
      const tenantKey = getTenantKey(req);
      const projectOid = safeOid(String(req.body?.projectId || req.query.projectId || req.params.id || ''));
      const folder = norm(req.params.folder);
      const name = String(req.body?.name || '').trim();

      if (!projectOid) return res.status(400).json({ error: 'projectId inválido' });
      if (!PROJECT_DOC_FOLDERS.includes(folder)) return res.status(400).json({ error: 'folder inválida' });
      if (!name) return res.status(400).json({ error: 'Nombre requerido' });

      const project = await Project.findOne({ _id: projectOid, tenantKey }).lean();
      if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

      const allowedFolders = await getAllowedProjectFolders(req, project);
      if (!allowedFolders.includes(folder)) {
        return res.status(403).json({ error: 'No tienes acceso a esta carpeta' });
      }

      let permission = await ProjectDocFolderPermission.findOne({ tenantKey, projectId: projectOid, folder });
      if (!permission) {
        permission = new ProjectDocFolderPermission({
          tenantKey,
          projectId: projectOid,
          folder,
          assignedUsers: fallbackFolderUsers(project, folder)
        });
      }

      const exists = (permission.subfolders || []).some(sf => norm(sf.name) === norm(name));
      if (!exists) {
        permission.subfolders.push({ name, createdBy: getUserId(req) });
        await permission.save();
      }

      res.status(201).json({ ok: true, subfolders: permission.subfolders || [] });
    } catch (e) {
      console.error('[documents.subfolders.create] error:', e);
      res.status(500).json({ error: e.message });
    }
  }
);

router.delete(
  '/folder-permissions/:folder/subfolders',
  attachProjectIdParam,
  requireRole('admin', 'bank', 'promoter'),
  requireProjectAccess({ commercialOnlySales: false }),
  async (req, res) => {
    try {
      const tenantKey = getTenantKey(req);
      const projectOid = safeOid(String(req.body?.projectId || req.query.projectId || req.params.id || ''));
      const folder = norm(req.params.folder);
      const name = String(req.body?.name || req.body?.subfolder || req.query?.name || req.query?.subfolder || '').trim();

      if (!projectOid) return res.status(400).json({ error: 'projectId inválido' });
      if (!PROJECT_DOC_FOLDERS.includes(folder)) return res.status(400).json({ error: 'folder inválida' });
      if (!name) return res.status(400).json({ error: 'Nombre requerido' });

      const project = await Project.findOne({ _id: projectOid, tenantKey }).lean();
      if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

      const allowedFolders = await getAllowedProjectFolders(req, project);
      if (!allowedFolders.includes(folder)) {
        return res.status(403).json({ error: 'No tienes acceso a esta carpeta' });
      }

      const permission = await ProjectDocFolderPermission.findOne({ tenantKey, projectId: projectOid, folder });
      if (!permission) return res.status(404).json({ error: 'Subcarpeta no encontrada' });

      const before = Array.isArray(permission.subfolders) ? permission.subfolders.length : 0;
      permission.subfolders = (permission.subfolders || []).filter(sf => norm(sf.name) !== norm(name));
      if (permission.subfolders.length === before) {
        return res.status(404).json({ error: 'Subcarpeta no encontrada' });
      }

      const moved = await Document.updateMany(
        { tenantKey, projectId: projectOid, folder, subfolder: name },
        { $set: { subfolder: '' } }
      );

      await permission.save();

      await audit(req, 'document.subfolder.deleted', {
        targetType: 'project',
        targetId: projectOid,
        projectId: projectOid,
        message: 'Subcarpeta documental eliminada',
        metadata: { folder, subfolder: name, movedDocuments: moved.modifiedCount || 0 }
      });

      res.json({ ok: true, subfolders: permission.subfolders || [], movedDocuments: moved.modifiedCount || 0 });
    } catch (e) {
      console.error('[documents.subfolders.delete] error:', e);
      res.status(500).json({ error: e.message });
    }
  }
);

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

      const proj = await Project.findOne({ _id: projectOid, tenantKey }).lean();
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

      let projectFolder = inferProjectFolder(req, department, category);
      if (!PROJECT_DOC_FOLDERS.includes(projectFolder)) {
        return res.status(400).json({ error: 'folder_invalida' });
      }

      const subfolder = getRequestedSubfolder(req);

      // ---- ACL ----
      const FULL = ['admin', 'bank', 'promoter', 'gerencia', 'socios', 'financiero', 'contable'];
      const LIMITED = ['legal', 'tecnico', 'commercial'];
      let checklistFolder = '';

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
          checklistFolder = projectFolderFromChecklistRole(cl.roleOwner);

          const inherited = [
            ...(Array.isArray(cl.visibleToRoles) ? cl.visibleToRoles.map(norm) : []),
            norm(cl.roleOwner)
          ];

          acl = Array.from(new Set([...inherited, ...FULL]));
        }
      }

      if (!getRequestedProjectFolder(req) && checklistFolder) {
        projectFolder = checklistFolder;
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

        if (replacedDoc.unitId && replacedDoc.department && !canAccessDocDepartment(req, replacedDoc.department)) {
          return res.status(403).json({ error: 'No puedes reemplazar este documento' });
        }

        if (!(await canAccessProjectDoc(req, replacedDoc))) {
          return res.status(403).json({ error: 'No tienes acceso a la carpeta del documento a reemplazar' });
        }

        if (!getRequestedProjectFolder(req)) {
          projectFolder = effectiveProjectFolder(replacedDoc);
        }
      }

      const allowedProjectFolders = await getAllowedProjectFolders(req, proj);
      if (!allowedProjectFolders.includes(projectFolder)) {
        return res.status(403).json({ error: 'No tienes permiso para subir documentos en esta carpeta' });
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
          folder: projectFolder,
          subfolder,

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

        await audit(req, 'document.uploaded', {
          targetType: 'document',
          targetId: doc._id,
          projectId: projectOid,
          message: 'Documento subido',
          metadata: {
            originalname: doc.originalname,
            mimetype: doc.mimetype,
            size: doc.size,
            category: doc.category,
            department: doc.department,
            unitId: doc.unitId,
            checklistId: doc.checklistId,
            permitCode: doc.permitCode
          }
        });
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
    const q = await buildDocsQuery(req);
    const list = await Document.find(q).sort({ createdAt: -1 }).lean();
    res.json(list.map(d => ({ ...d, folder: effectiveProjectFolder(d), subfolder: d.subfolder || '' })));
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

      if (doc.unitId && doc.department && !canAccessDocDepartment(req, doc.department)) {
        return res.status(403).json({ error: 'No tienes permiso para este documento' });
      }

      if (!(await canAccessProjectDoc(req, doc))) {
        return res.status(403).json({ error: 'No tienes acceso a la carpeta de este documento' });
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

router.patch(
  '/:id/location',
  requireRole('admin', 'bank', 'promoter'),
  loadDocAndAttachProject,
  requireProjectAccess({ commercialOnlySales: false }),
  async (req, res) => {
    try {
      const tenantKey = getTenantKey(req);
      const docId = req.params.docId || req.params.id;
      const folder = getRequestedProjectFolder(req);
      const subfolder = getRequestedSubfolder(req);

      if (!PROJECT_DOC_FOLDERS.includes(folder)) {
        return res.status(400).json({ error: 'folder inválida' });
      }

      const doc = await Document.findOne({ _id: docId, tenantKey });
      if (!doc) return res.status(404).json({ error: 'Documento no encontrado' });

      const project = await Project.findOne({ _id: doc.projectId, tenantKey }).lean();
      if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

      const allowedFolders = await getAllowedProjectFolders(req, project);
      if (!allowedFolders.includes(folder)) {
        return res.status(403).json({ error: 'No tienes acceso a la carpeta destino' });
      }

      if (!(await canAccessProjectDoc(req, doc))) {
        return res.status(403).json({ error: 'No tienes acceso a la carpeta actual del documento' });
      }

      if (subfolder) {
        const permission = await ProjectDocFolderPermission
          .findOne({ tenantKey, projectId: doc.projectId, folder })
          .lean();
        const exists = (permission?.subfolders || []).some(sf => norm(sf.name) === norm(subfolder));

        if (!exists) {
          return res.status(400).json({ error: 'subfolder_not_found' });
        }
      }

      doc.folder = folder;
      doc.subfolder = subfolder || '';
      await doc.save();

      await audit(req, 'document.moved', {
        targetType: 'document',
        targetId: doc._id,
        projectId: doc.projectId,
        message: 'Documento movido de carpeta',
        metadata: { folder, subfolder: doc.subfolder }
      });

      res.json({ ok: true, document: doc.toObject() });
    } catch (e) {
      console.error('[documents.location] error:', e);
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

    if (doc.unitId && doc.department && !canAccessDocDepartment(req, doc.department)) {
      return res.status(403).json({ error: 'No tienes permiso para este documento' });
    }

    if (!(await canAccessProjectDoc(req, doc))) {
      return res.status(403).json({ error: 'No tienes acceso a la carpeta de este documento' });
    }

    if (!doc.projectId && !isFullAccess(role)) {
      const acl = (doc.visibleToRoles || []).map(norm);

      if (acl.length && !acl.includes(role)) {
        return res.status(403).json({ error: 'No tienes permiso para este documento' });
      }
    }

    const absPath = path.isAbsolute(doc.path) ? doc.path : path.join(__dirname, '..', doc.path);

    if (!fs.existsSync(absPath)) {
      return res.status(404).json({ error: 'Archivo no existe en servidor' });
    }

    res.setHeader('Cache-Control', 'private, no-store');
    await audit(req, 'document.downloaded', {
      targetType: 'document',
      targetId: doc._id,
      projectId: doc.projectId,
      message: 'Documento descargado',
      metadata: {
        originalname: doc.originalname,
        mimetype: doc.mimetype,
        size: doc.size,
        category: doc.category,
        department: doc.department
      }
    });
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

    if (doc.unitId && doc.department && !canAccessDocDepartment(req, doc.department)) {
      return res.status(403).json({ error: 'No tienes permiso para eliminar este documento' });
    }

    if (!(await canAccessProjectDoc(req, doc))) {
      return res.status(403).json({ error: 'No tienes acceso a la carpeta de este documento' });
    }

    await Document.deleteOne({ _id: docId, tenantKey });

    await audit(req, 'document.deleted', {
      targetType: 'document',
      targetId: doc._id,
      projectId: doc.projectId,
      message: 'Documento eliminado',
      metadata: {
        originalname: doc.originalname,
        mimetype: doc.mimetype,
        size: doc.size,
        category: doc.category,
        department: doc.department
      }
    });

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
