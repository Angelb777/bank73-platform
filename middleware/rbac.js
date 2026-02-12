// middleware/rbac.js
// Control de acceso por rol + acceso a proyectos asignados
const Project = require('../models/Project');

// ------- Config de roles/áreas --------
const FULL_ACCESS_ROLES = [
  'admin',
  'bank',
  'promoter',
  'gerencia',
  'socios',
  'financiero',
  'contable'
];

const LIMITED_AREA_ROLES = [
  'commercial', // ventas/units
  'legal',      // checklists/docs
  'tecnico'     // checklists/docs
];

// ------- Helpers de rol/tenant --------
function norm(s) { return (s || '').toString().toLowerCase().trim(); }

function requireRole(...roles) {
  const allowed = roles.map(norm);
  return (req, res, next) => {
    const r = norm(req.user?.role);
    if (!r) return res.status(403).json({ error: 'Sin rol' });
    if (!allowed.includes(r)) return res.status(403).json({ error: 'Acceso denegado' });
    next();
  };
}

// Alias retrocompatible
const requireRoles = requireRole;

function sameTenant(req, project) {
  const t =
    req.tenant?.key ||
    req.tenant?.tenantKey ||
    req.tenantKey ||
    req.user?.tenantKey ||
    req.headers['x-tenant'] ||
    req.headers['x-tenant-key'] ||
    undefined;

  return t && project?.tenantKey && String(t) === String(project.tenantKey);
}

function includesObjectId(arr, id) {
  if (!Array.isArray(arr) || !id) return false;
  const idStr = String(id);
  return arr.some(x => String(x) === idStr);
}

async function loadProjectIfNeeded(req) {
  if (req.project) return req.project;

  const projectId =
    req.params?.id ||
    req.params?.projectId ||
    req.body?.projectId ||
    req.query?.projectId ||
    req.query?.proj ||          // 👈 alias común en tus rutas
    req.body?.proj;

  if (!projectId) return null;

  const proj = await Project.findById(projectId).lean();
  if (proj) req.project = proj;
  return proj;
}

// Intenta determinar si el usuario está asignado al proyecto, probando varios campos posibles
function isUserAssignedToProject(project, userId) {
   if (!project || !userId) return false;
   const u = userId;

   // Arrays “legacy” y específicos por rol
   const candidateArrays = [
     project.assignedUsers,
     project.teamUsers,
     project.members,
     project.assignedPromoters,
     project.assignedCommercials,
     project.assignedLegal,
     project.assignedTecnicos,
     project.assignedGerencia,
     project.assignedSocios,
     project.assignedFinanciero,
     project.assignedContable
   ].filter(Boolean);

   // Mapa genérico: assignees.{rol} = [ObjectId]
   const ass = project.assignees || {};
   const assigneeArrays = [
     ass.promoter, ass.commercial, ass.legal, ass.tecnico,
     ass.gerencia, ass.socios, ass.financiero, ass.contable
   ].filter(Boolean);

   const pools = [...candidateArrays, ...assigneeArrays];
  // Si no hay nada definido, mejor ser explícitos: NO asignado
   if (pools.length === 0) return false;

   return pools.some(arr => includesObjectId(arr, u));
 }
// Detección de áreas por URL (muy simple y defensiva)
function detectArea(req) {
  const url = (req.baseUrl || '') + (req.path || '');
  const method = (req.method || 'GET').toUpperCase();

  const isSales =
    req.isSalesRoute === true ||
    /\/ventas(\/|$)/i.test(url) ||
    req.isUnitsRoute === true ||
    /\/units?(\/|$)/i.test(url);

  const isChecklists = /\/(checklists?|tasks?|permits)(\/|$)/i.test(url);
  
  const isDocs = /\/docs?(\/|$)/i.test(url);

  return { url, method, isSales, isChecklists, isDocs };
}

// ------- Middleware principal por proyecto --------
//
// Opciones:
//   allowCreateFor: ['admin','bank']
//   promoterCanEditAssigned: true
//   commercialOnlySales: true
//
function requireProjectAccess(options = {}) {
  const {
    allowCreateFor = ['admin', 'bank'],
    promoterCanEditAssigned = true,
    commercialOnlySales = true
  } = options;

  return async (req, res, next) => {
    try {
      const role = norm(req.user?.role);
      if (!role) return res.status(403).json({ error: 'Acceso denegado: usuario sin rol' });

      // ADMIN: todo
      if (role === 'admin') return next();

      // Crear proyectos (POST /projects)
      const isCreateAttempt =
        req.method === 'POST' && /\/projects(\/)?$/i.test((req.baseUrl || '') + (req.path || ''));
      if (isCreateAttempt) {
        if (!allowCreateFor.map(norm).includes(role)) {
          return res.status(403).json({ error: 'No tienes permisos para crear proyectos' });
        }
        return next();
      }

      // Cargar proyecto si aplica
      const project = await loadProjectIfNeeded(req);
      if (!project) return next(); // rutas que no operan sobre un proyecto concreto

      // Tenant must match
      if (!sameTenant(req, project)) {
        return res.status(403).json({ error: 'Proyecto no pertenece a tu tenant' });
      }

      // --- SOLO LECTURA en /permits: permitir GET a cualquiera ASIGNADO ---
      const isPermitsGet =
        req.method === 'GET' &&
        /\/permits(\/|$)/i.test((req.baseUrl || '') + (req.path || ''));
      if (isPermitsGet) {
        const assigned = isUserAssignedToProject(project, (req.user?._id || req.user?.userId));
        if (!assigned && role !== 'admin' && role !== 'bank') {
          return res.status(403).json({ error: 'Proyecto no asignado' });
        }
        // No comprobamos publishStatus ni área: sólo lectura
        return next();
      }

      // --- Reglas por rol “normales” a partir de aquí ---
      const area = detectArea(req);

      // BANK: libre dentro del tenant
      if (role === 'bank') return next();

      // PROMOTER
      if (role === 'promoter') {
        const assigned = isUserAssignedToProject(project, (req.user?._id || req.user?.userId));
        if (!assigned) return res.status(403).json({ error: 'Proyecto no asignado al promotor' });
        if (project.publishStatus && project.publishStatus !== 'approved') {
          return res.status(403).json({ error: 'Proyecto en revisión o rechazado (no accesible para promotor)' });
        }
        if (!promoterCanEditAssigned && ['POST','PUT','PATCH','DELETE'].includes(area.method)) {
          return res.status(403).json({ error: 'Promotor sin permisos de edición' });
        }
        return next();
      }

      // GERENCIA / SOCIOS / FINANCIERO / CONTABLE
      if (['gerencia','socios','financiero','contable'].includes(role)) {
        const assigned = isUserAssignedToProject(project, req.user?.userId);
        if (!assigned) return res.status(403).json({ error: 'Proyecto no asignado' });
        if (project.publishStatus && project.publishStatus !== 'approved') {
          return res.status(403).json({ error: 'Proyecto en revisión o rechazado' });
        }
        return next();
      }

      // COMMERCIAL
      if (role === 'commercial') {
        const assigned = isUserAssignedToProject(project, req.user?.userId);
        if (!assigned) return res.status(403).json({ error: 'Proyecto no asignado al comercial' });
        if (project.publishStatus && project.publishStatus !== 'approved') {
          return res.status(403).json({ error: 'Proyecto en revisión o rechazado (no accesible para comercial)' });
        }
        if (commercialOnlySales && !area.isSales) {
          return res.status(403).json({ error: 'Comercial sólo puede acceder a ventas/unidades del proyecto' });
        }
        return next();
      }

      // LEGAL y TECNICO
      if (role === 'legal' || role === 'tecnico') {
        const assigned = isUserAssignedToProject(project, req.user?.userId);
        if (!assigned) return res.status(403).json({ error: 'Proyecto no asignado' });
        if (project.publishStatus && project.publishStatus !== 'approved') {
          return res.status(403).json({ error: 'Proyecto en revisión o rechazado' });
        }
        if (!(area.isChecklists || area.isDocs)) {
          return res.status(403).json({ error: 'Acceso permitido sólo a checklists y documentos' });
        }
        return next();
      }

      // Cualquier otro rol futuro => denegado
      return res.status(403).json({ error: 'Acceso denegado' });
    } catch (err) {
      console.error('[rbac] requireProjectAccess error:', err);
      return res.status(500).json({ error: 'Error de autorización' });
    }
  };
}

module.exports = {
  requireRole,
  requireRoles,     // alias
  requireProjectAccess,
  // exportamos también utilidades por si quieres usarlas en otras rutas/controladores
  _helpers: {
    sameTenant,
    includesObjectId,
    loadProjectIfNeeded,
    isUserAssignedToProject,
    detectArea,
    FULL_ACCESS_ROLES,
    LIMITED_AREA_ROLES
  }
};
