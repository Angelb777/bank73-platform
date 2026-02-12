// routes/permits.js
'use strict';

const express = require('express');
const PermitTemplate = require('../models/PermitTemplate');
const ProjectPermit  = require('../models/ProjectPermit');
const Project        = require('../models/Project');
const { requireRole, requireProjectAccess } = require('../middleware/rbac');

const router = express.Router();

/**
 * Copia req.params.projectId -> req.params.id para middlewares
 * que esperan "id" (p. ej. requireProjectAccess).
 */
function normalizeProjectParam(req, _res, next) {
  if (!req.params.id && req.params.projectId) {
    req.params.id = req.params.projectId; // alias para RBAC
  }
  next();
}

/**
 * Obtiene tenantKey de forma segura:
 * - user.tenantKey
 * - req.tenantKey / req.tenant (puesto por tenantMw)
 * - headers X-Tenant / X-Tenant-Key / query/body
 * - Fallback final: si hay projectId, leer tenant del propio proyecto
 */
async function getTenantKey(req) {
  let t =
    req?.user?.tenantKey ||
    req.tenantKey ||
    req?.tenant?.tenantKey ||
    req?.tenant?.key ||
    req.headers['x-tenant-key'] ||
    req.headers['x-tenant'] ||
    req.query?.tenantKey ||
    req.body?.tenantKey ||
    null;

  // ⬇️ fallback: leer del proyecto con varios posibles nombres de campo
  if (!t && req.params?.projectId) {
    try {
      const proj = await Project.findById(req.params.projectId)
        .select('tenantKey tenant key orgKey organization organizationKey tenant_id')
        .lean();

      t =
        proj?.tenantKey ||
        proj?.tenant ||
        proj?.key ||
        proj?.orgKey ||
        proj?.organization ||
        proj?.organizationKey ||
        proj?.tenant_id ||
        t;
    } catch (_) { /* noop */ }
  }

  // último intento: si el user ya viene autenticado y trae tenantKey
  if (!t && req.user?.tenantKey) t = req.user.tenantKey;

  return t || null;
}

/**
 * A veces requireProjectAccess depende de req.user.tenantKey.
 * Este middleware lo hidrata usando los mismos fallbacks de arriba.
 */
async function hydrateUserTenant(req, _res, next) {
  try {
    if (!req.user) return next();
    if (!req.user.tenantKey) {
      const t = await getTenantKey(req);
      if (t) req.user.tenantKey = t;
    }
    next();
  } catch (e) {
    next(e);
  }
}

function parseDays(v) {
  if (v == null) return 0;
  const s = String(v).toUpperCase();
  const n = parseInt(s.match(/\d+/)?.[0] || '0', 10);
  if (!Number.isFinite(n)) return 0;
  if (/\bMES/.test(s)) return n * 30; // opcional: “3 MESES” -> 90
  return n;
}

function validateTemplate(tpl) {
  const errors = [];
  const seen = new Set();
  const exists = new Set((tpl.items || []).map(i => i.code).filter(Boolean));
  for (const it of (tpl.items || [])) {
    if (!it.code?.trim()) errors.push(`Item sin code (title="${it.title || 'sin título'}")`);
    if (!it.title?.trim()) errors.push(`Item ${it.code || '(sin code)'} sin title`);
    if (it.code) {
      if (seen.has(it.code)) errors.push(`Código duplicado en plantilla: ${it.code}`);
      seen.add(it.code);
    }
    for (const d of (it.dependencies || [])) {
      if (!exists.has(d)) errors.push(`Dependencia inexistente: ${it.code} -> ${d}`);
    }
  }
  return errors;
}


/* ============================
   PLANTILLAS (ADMIN/GERENCIA)
   ============================ */

// Listar plantillas
router.get('/templates', async (req, res, next) => {
  try {
    const tenantKey = await getTenantKey(req);
    if (!tenantKey) {
      console.warn('[permits/templates] missing tenantKey');
      return res.status(401).json({ error: 'unauthorized' });
    }

    const templates = await PermitTemplate.find({ tenantKey }).lean();
    return res.json(templates || []);
  } catch (err) {
    return next(err);
  }
});

// Crear plantilla
router.post('/templates', requireRole('admin', 'gerencia'), async (req, res, next) => {
  try {
    const tenantKey = await getTenantKey(req);
    if (!tenantKey) {
      console.warn('[permits/templates POST] missing tenantKey');
      return res.status(401).json({ error: 'unauthorized' });
    }

    const tpl = await PermitTemplate.create({
      ...req.body,
      tenantKey
    });
    return res.status(201).json(tpl);
  } catch (err) {
    return next(err);
  }
});

/* ============================
   PROYECTOS
   ============================ */

   // ✅ LEGACY: GET /api/permits?projectId=...
router.get('/', async (req, res, next) => {
  try {
    const projectId = req.query.projectId;
    if (!projectId) return res.status(400).json({ error: 'projectId requerido' });

    const tenantKey = await getTenantKey(req);
    if (!tenantKey) return res.status(401).json({ error: 'unauthorized' });

    // Validar tenant del proyecto
    const proj = await Project.findById(projectId).select('tenantKey').lean();
    if (!proj) return res.status(404).json({ error: 'project_not_found' });
    if (String(proj.tenantKey) !== String(tenantKey)) {
      return res.status(403).json({ error: 'Proyecto no pertenece a tu tenant' });
    }

    // OJO: ProjectPermit es 1 doc por proyecto (como tú lo creas)
    const pp = await ProjectPermit.findOne({ tenantKey, projectId }).lean();
    if (!pp) return res.status(404).json({ error: 'not_initialized' });

    return res.json(pp);
  } catch (e) {
    return next(e);
  }
});

// Inicializar permisos en un proyecto desde plantilla (usa siempre el tenant del proyecto)
// Inicializar/Agregar permisos desde plantilla
router.post('/projects/:projectId/init', async (req, res, next) => {
  console.log('[TRACE] /api/permits >>> POST init', {
  projectId: req.params.projectId,
  templateId: req.body?.templateId
});

  try {
    // 1) Proyecto y tenant
    const proj = await Project.findById(req.params.projectId).select('tenantKey').lean();
    if (!proj) return res.status(404).json({ error: 'project_not_found' });

    const tenantKey = String(proj.tenantKey || '').trim();
    if (!tenantKey) return res.status(401).json({ error: 'unauthorized' });

    // 2) Validaciones
    const { templateId } = req.body || {};
    if (!templateId) return res.status(400).json({ error: 'templateId_required' });

    // 3) Plantilla del MISMO tenant
    const tpl = await PermitTemplate.findOne({ _id: templateId, tenantKey }).lean();
    if (!tpl) return res.status(404).json({ error: 'template_not_found' });

    // 3.1) Validación “humana”
    const verrors = validateTemplate(tpl);
    if (verrors.length) {
      return res.status(400).json({ error: 'invalid_template', details: verrors });
    }

    // 4) Mapeo limpio de items de plantilla
    const mapped = (tpl.items || []).map(i => ({
      code:         i.code,
      title:        i.title,
      institution:  i.institution || '',
      type:         i.type || (String(i.title || '').split(' - ')[0] || 'General'),
      requirements: i.requirements || [],
      observations: i.observations || [],
      slaDays:      parseDays(i.slaDays ?? 0),
      dependencies: i.dependencies || [],
      status:       'pending'
    }));

    // 5) Buscar permisos existentes del proyecto
    const existing = await ProjectPermit.findOne({ tenantKey, projectId: req.params.projectId });

    if (!existing) {
      // Primera vez → crear
      const pp = await ProjectPermit.create({
        tenantKey,
        projectId: req.params.projectId,
        templateId: tpl._id,
        templateVersion: tpl.version || 1,
        items: mapped
      });
      return res.status(201).json(pp);
    }

    // 6) Ya hay permisos → FUSIONAR (append por code sin duplicar)
    const byCode = new Map(existing.items.map(i => [i.code, i]));

    let added = 0, updated = 0;
    for (const ni of mapped) {
      const cur = byCode.get(ni.code);
      if (!cur) {
        existing.items.push(ni);
        byCode.set(ni.code, ni);
        added++;
      } else {
        // 🔧 Si quieres refrescar datos de los existentes (sin tocar status/fechas):
        cur.title        = ni.title;
        cur.institution  = ni.institution;
        cur.type         = ni.type;
        cur.requirements = ni.requirements;
        cur.observations = ni.observations;
        cur.slaDays      = ni.slaDays;
        cur.dependencies = ni.dependencies;
        updated++;
      }
    }

    // Marcar versión de la última plantilla aplicada (opcional: podrías mantener historial)
    existing.templateVersion = tpl.version || existing.templateVersion || 1;

    await existing.save();
    const fresh = await ProjectPermit.findById(existing._id).lean();

    return res.status(200).json({
      ...fresh,
      _mergeInfo: { added, updated, templateApplied: tpl.name }
    });
  } catch (err) {
    console.error('[permits:init] error', err);
    return res.status(400).json({ error: err.message || 'init_failed' });
  }
});


// Obtener permisos de un proyecto
// Obtener permisos de un proyecto (LECTURA ABIERTA dentro del tenant)
router.get(
  '/projects/:projectId',
  normalizeProjectParam,
  hydrateUserTenant,           // mantiene user.tenantKey si hace falta
  async (req, res, next) => {
    try {
      const tenantKey = await getTenantKey(req);
      if (!tenantKey) {
        console.warn('[permits/get project] missing tenantKey');
        return res.status(401).json({ error: 'unauthorized' });
      }

      // ✅ Validación explícita de TENANT (sin RBAC por rol/asignación)
      const proj = await Project.findById(req.params.projectId).select('tenantKey').lean();
      if (!proj) return res.status(404).json({ error: 'project_not_found' });
      if (String(proj.tenantKey) !== String(tenantKey)) {
        return res.status(403).json({ error: 'Proyecto no pertenece a tu tenant' });
      }

      // Carga de permisos limitada por tenant + projectId
      const pp = await ProjectPermit.findOne({
        tenantKey,
        projectId: req.params.projectId
      }).lean();

      if (!pp) return res.status(404).json({ error: 'not_initialized' });
      return res.json(pp);
    } catch (err) {
      return next(err);
    }
  }
);

// Actualizar estado (u otros campos permitidos) de un ítem
// Actualizar estado (u otros campos permitidos) de un ítem
router.patch(
  '/projects/:projectId/items/:code',
  normalizeProjectParam,
  hydrateUserTenant, // opcional, ya no dependemos de requireProjectAccess
  async (req, res, next) => {
    try {
      const tenantKey = await getTenantKey(req);
      if (!tenantKey) {
        console.warn('[permits/patch item] missing tenantKey');
        return res.status(401).json({ error: 'unauthorized' });
      }

      const { projectId, code } = req.params;

      // 🛡️ Validar que el proyecto pertenece al tenant
      const proj = await Project.findById(projectId).select('tenantKey').lean();
      if (!proj) return res.status(404).json({ error: 'project_not_found' });
      if (String(proj.tenantKey) !== String(tenantKey)) {
        return res.status(403).json({ error: 'forbidden' });
      }

      // Cargar permisos del proyecto
      const pp = await ProjectPermit.findOne({ tenantKey, projectId });
      if (!pp) return res.status(404).json({ error: 'not_initialized' });

      const item = pp.items.find(i => i.code === code);
      if (!item) return res.status(404).json({ error: 'item_not_found' });

      // Campos permitidos desde UI
      const allowed = ['status', 'slaDays', 'requirements', 'observations'];
      for (const k of allowed) {
        if (Object.prototype.hasOwnProperty.call(req.body, k)) {
          item[k] = req.body[k];
        }
      }

      await pp.save();

      // No-cache y devolver documento fresco
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.set('Pragma', 'no-cache');

      const fresh = await ProjectPermit.findById(pp._id).lean();
      return res.json(fresh);
    } catch (err) {
      console.error('[permits/patch] error', err);
      return res.status(400).json({ error: err.message || 'patch_failed' });
    }
  }
);


module.exports = router;
