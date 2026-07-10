// routes/admin.js
const express = require('express');
const User = require('../models/User');
const Project = require('../models/Project'); // ROLE-SEP
const Tenant = require('../models/Tenant');
const AuditLog = require('../models/AuditLog');
const ProjectFinance = require('../models/ProjectFinance');
const Unit = require('../models/Unit');
const Venta = require('../models/Venta');
const Document = require('../models/Document');
const ProjectChecklist = require('../models/ProjectChecklist');
const ProjectPermit = require('../models/ProjectPermit');
const ChatMessage = require('../models/ChatMessage');
const Provider = require('../models/Provider');
const { PROVIDER_STAGE_SERVICES } = require('../models/Provider');
const ProviderRequest = require('../models/ProviderRequest');
const AppSetting = require('../models/AppSetting');
const { requireRole } = require('../middleware/rbac'); // ROLE-SEP
const audit = require('../utils/audit');
const { tenantKeyFromBankName: sharedTenantKeyFromBankName } = require('../utils/tenants');
const { sanitizePromoterProfile: sanitizePromoterProfileShared } = require('../utils/promoterProfile');
const router = express.Router();

const { ROLES: VALID_ROLES } = require('../models/User'); // usa la misma fuente que el modelo
const { promoterProfileCompletion } = require('../models/User');
const VALID_PUBLISH = ['draft','pending','approved','rejected']; // ROLE-SEP
const PROVIDERS_MODULE_SETTING_KEY = 'providersModule';

function cleanProviderBody(body = {}) {
  const pick = (key, max = 500) => String(body[key] ?? '').trim().slice(0, max);
  return {
    commercialName: pick('commercialName', 160),
    logoUrl: pick('logoUrl', 2000000),
    description: pick('description', 700),
    country: pick('country', 100),
    city: pick('city', 100),
    stage: pick('stage', 120),
    serviceType: pick('serviceType', 120),
    specialty: pick('specialty', 220),
    exclusiveCondition: pick('exclusiveCondition', 220),
    phone: pick('phone', 80),
    email: pick('email', 180).toLowerCase(),
    website: pick('website', 240),
    isActive: body.isActive === undefined ? true : body.isActive === true || body.isActive === 'true'
  };
}

function validateProviderPayload(payload) {
  if (!payload.commercialName) return 'Falta el nombre comercial.';
  if (!payload.stage || !PROVIDER_STAGE_SERVICES[payload.stage]) return 'Etapa inválida.';
  if (!payload.serviceType || !PROVIDER_STAGE_SERVICES[payload.stage].includes(payload.serviceType)) {
    return 'Tipo de servicio inválido para la etapa seleccionada.';
  }
  if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return 'Correo electrónico inválido.';
  return '';
}

function sanitizeTenantKeys(input, fallbackTenantKey, options = {}) {
  const raw = Array.isArray(input)
    ? input
    : String(input || '').split(/\r?\n|,/);
  const values = options.includeFallback ? [fallbackTenantKey, ...raw] : raw;
  return Array.from(new Set(values.map(v => String(v || '').trim()).filter(Boolean))).slice(0, 50);
}

async function ensureBankTenants(input = []) {
  const raw = Array.isArray(input) ? input : [];
  const out = [];
  const seen = new Set();

  for (const item of raw) {
    const name = String(item?.name || item?.label || item || '').trim();
    const tenantKey = String(item?.tenantKey || sharedTenantKeyFromBankName(name)).trim();
    if (!tenantKey || seen.has(tenantKey)) continue;
    seen.add(tenantKey);

    await Tenant.findOneAndUpdate(
      { tenantKey },
      { $setOnInsert: { tenantKey, name: name || tenantKey } },
      { upsert: true, new: true }
    );
    out.push(tenantKey);
  }

  return out;
}

function safeTenantKey(value) {
  return String(value || '').trim().slice(0, 120);
}

function tenantUserFilter(tenantKey) {
  return { $or: [{ tenantKey }, { tenantKeys: tenantKey }] };
}

function projectAssignedToUsersFilter(userIds = []) {
  return {
    $or: [
      { assignedPromoters: { $in: userIds } },
      { assignedCommercials: { $in: userIds } },
      { assignedBanks: { $in: userIds } },
      { assignedLegal: { $in: userIds } },
      { assignedTecnicos: { $in: userIds } },
      { assignedGerencia: { $in: userIds } },
      { assignedSocios: { $in: userIds } },
      { assignedFinanciero: { $in: userIds } },
      { assignedContable: { $in: userIds } }
    ]
  };
}

async function tenantAssignedProjects(tenantKey, projection = null) {
  const users = await User.find(tenantUserFilter(tenantKey)).select('_id').lean();
  const userIds = users.map(u => u._id);

  if (tenantKey === 'bancodemo') {
    const query = Project.find({}).sort({ createdAt: -1 });
    if (projection) query.select(projection);
    const projects = await query.lean();
    return { usersCount: users.length, projects };
  }

  if (!userIds.length) return { usersCount: 0, projects: [] };

  const query = Project.find(projectAssignedToUsersFilter(userIds)).sort({ createdAt: -1 });
  if (projection) query.select(projection);
  const projects = await query.lean();
  return { usersCount: userIds.length, projects };
}

function projectAssignedUserIds(projects = []) {
  const ids = new Set();
  const fields = [
    'createdBy',
    'assignedPromoters',
    'assignedCommercials',
    'assignedBanks',
    'assignedLegal',
    'assignedTecnicos',
    'assignedGerencia',
    'assignedSocios',
    'assignedFinanciero',
    'assignedContable'
  ];
  for (const project of projects) {
    for (const field of fields) {
      const value = project[field];
      const values = Array.isArray(value) ? value : [value];
      values.filter(Boolean).forEach(id => ids.add(String(id)));
    }
  }
  return Array.from(ids);
}

function sanitizeExportUser(user, tenantKey) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    tenantKey: user.tenantKey === tenantKey ? user.tenantKey : undefined,
    tenantKeys: Array.isArray(user.tenantKeys) && user.tenantKeys.includes(tenantKey) ? [tenantKey] : [],
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    promoterCategory: user.promoterCategory,
    promoterProfile: user.promoterProfile || undefined
  };
}

async function collectTenantExport(tenantKey, actor = {}) {
  const tenant = await Tenant.findOne({ tenantKey }).lean();
  const projects = await Project.find({ tenantKey }).sort({ createdAt: -1 }).lean();
  const projectIds = projects.map(p => p._id);
  const projectFilter = { tenantKey, projectId: { $in: projectIds } };

  const [
    projectFinance,
    units,
    ventas,
    documents,
    checklists,
    permits,
    chatMessages,
    auditLogs
  ] = await Promise.all([
    ProjectFinance.find({ tenantKey, project: { $in: projectIds } }).lean(),
    Unit.find(projectFilter).lean(),
    Venta.find(projectFilter).lean(),
    Document.find(projectFilter).lean(),
    ProjectChecklist.find(projectFilter).lean(),
    ProjectPermit.find(projectFilter).lean(),
    ChatMessage.find(projectFilter).lean(),
    AuditLog.find({
      tenantKey,
      $or: [
        { projectId: { $in: projectIds } },
        { targetType: 'project', targetId: { $in: projectIds } }
      ]
    }).sort({ createdAt: -1 }).lean()
  ]);

  const userIds = new Set(projectAssignedUserIds(projects));
  documents.forEach(d => { if (d.uploadedBy) userIds.add(String(d.uploadedBy)); });
  checklists.forEach(c => (c.notes || []).forEach(n => { if (n.userId) userIds.add(String(n.userId)); }));
  chatMessages.forEach(m => { if (m.userId) userIds.add(String(m.userId)); });
  auditLogs.forEach(l => { if (l.actorUserId) userIds.add(String(l.actorUserId)); });

  const users = await User.find({
    $or: [
      { tenantKey },
      { tenantKeys: tenantKey },
      { _id: { $in: Array.from(userIds) } }
    ]
  }, { password: 0 }).lean();

  return {
    manifest: {
      exportType: 'tenant-json',
      tenantKey,
      tenantName: tenant?.name || tenantKey,
      generatedAt: new Date().toISOString(),
      generatedBy: {
        userId: actor.userId || '',
        email: actor.email || '',
        role: actor.role || ''
      },
      security: {
        source: `Project.find({ tenantKey: "${tenantKey}" })`,
        tenantFilterApplied: true,
        projectScopedCollectionsUseProjectIds: true,
        legacyTenantlessIncluded: false,
        physicalDocumentsIncluded: false
      },
      counts: {
        projects: projects.length,
        projectFinance: projectFinance.length,
        units: units.length,
        ventas: ventas.length,
        documentsMetadata: documents.length,
        checklists: checklists.length,
        permits: permits.length,
        chatMessages: chatMessages.length,
        auditLogs: auditLogs.length,
        users: users.length
      }
    },
    tenant: tenant || { tenantKey },
    projects,
    projectFinance,
    units,
    ventas,
    documentsMetadata: documents,
    projectChecklists: checklists,
    projectPermits: permits,
    chatMessages,
    auditLogs,
    users: users.map(u => sanitizeExportUser(u, tenantKey))
  };
}

// ROLE-SEP: Todas estas rutas requieren rol admin (además de auth y tenant previos en server.js)
router.use(requireRole('admin')); // ROLE-SEP

/* =========================================================================
   ACTIVIDAD / AUDITORÍA
   ========================================================================= */

router.get('/audit-logs', async (req, res) => {
  try {
    const q = { tenantKey: req.tenantKey };
    const action = String(req.query.action || '').trim();
    const status = String(req.query.status || '').trim();
    const search = String(req.query.q || '').trim();

    if (action) q.action = action;
    if (status) q.status = status;

    if (search) {
      const rx = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      q.$or = [
        { action: rx },
        { actorEmail: rx },
        { actorRole: rx },
        { targetType: rx },
        { message: rx },
        { ip: rx }
      ];
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 80, 10), 200);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      AuditLog.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(q)
    ]);

    res.json({ logs, total, page, limit });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =========================================================================
   PROVEEDORES BANK73
   ========================================================================= */

router.get('/providers/options', (_req, res) => {
  res.json({ stageServices: PROVIDER_STAGE_SERVICES });
});

router.get('/providers/module-settings', async (_req, res) => {
  try {
    const setting = await AppSetting.findOne({ key: PROVIDERS_MODULE_SETTING_KEY }).lean();
    res.json({ enabled: setting?.value?.enabled !== false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/providers/module-settings', async (req, res) => {
  try {
    const enabled = req.body?.enabled === true || req.body?.enabled === 'true';
    const setting = await AppSetting.findOneAndUpdate(
      { key: PROVIDERS_MODULE_SETTING_KEY },
      { $set: { value: { enabled } } },
      { upsert: true, new: true }
    );

    await audit(req, 'provider_module.visibility_updated', {
      targetType: 'app_setting',
      targetId: setting._id,
      status: enabled ? 'success' : 'info',
      message: enabled ? 'Módulo Proveedores activado' : 'Módulo Proveedores desactivado',
      metadata: { enabled }
    });

    res.json({ ok: true, enabled });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/providers', async (_req, res) => {
  try {
    const providers = await Provider.find({})
      .sort({ stage: 1, serviceType: 1, commercialName: 1 })
      .lean();
    const counts = await ProviderRequest.aggregate([
      { $match: { status: 'pending' } },
      { $group: { _id: '$provider', count: { $sum: 1 } } }
    ]);
    const countMap = new Map(counts.map(item => [String(item._id), item.count]));
    res.json({
      providers: providers.map(provider => ({
        ...provider,
        pendingRequestsCount: countMap.get(String(provider._id)) || 0
      }))
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/provider-requests', async (req, res) => {
  try {
    const q = {};
    const providerId = String(req.query.providerId || '').trim();
    const status = String(req.query.status || '').trim();
    if (providerId) q.provider = providerId;
    if (status) q.status = status;

    const requests = await ProviderRequest.find(q)
      .sort({ requestedAt: -1 })
      .populate('provider', 'commercialName stage serviceType')
      .populate('project', 'name tenantKey')
      .populate('requestedBy', 'name email role')
      .lean();
    res.json({ requests });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/provider-requests/:id/reviewed', async (req, res) => {
  try {
    const request = await ProviderRequest.findByIdAndUpdate(req.params.id, {
      status: 'reviewed',
      reviewedAt: new Date(),
      reviewedBy: req.user?._id || req.user?.userId
    }, { new: true });
    if (!request) return res.status(404).json({ error: 'Solicitud no encontrada' });

    await audit(req, 'provider_request.reviewed', {
      targetType: 'provider_request',
      targetId: request._id,
      projectId: request.project,
      message: 'Solicitud de proveedor marcada como revisada',
      metadata: { provider: request.provider, serviceType: request.serviceType }
    });

    res.json({ ok: true, request });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/providers/:id/requests/reviewed', async (req, res) => {
  try {
    const provider = await Provider.findById(req.params.id).lean();
    if (!provider) return res.status(404).json({ error: 'Proveedor no encontrado' });

    const result = await ProviderRequest.updateMany(
      { provider: req.params.id, status: 'pending' },
      {
        $set: {
          status: 'reviewed',
          reviewedAt: new Date(),
          reviewedBy: req.user?._id || req.user?.userId
        }
      }
    );

    await audit(req, 'provider_request.reviewed_bulk', {
      targetType: 'provider',
      targetId: provider._id,
      message: 'Solicitudes de proveedor marcadas como revisadas',
      metadata: { commercialName: provider.commercialName, reviewedCount: result.modifiedCount || 0 }
    });

    res.json({ ok: true, reviewedCount: result.modifiedCount || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/providers', async (req, res) => {
  try {
    const payload = cleanProviderBody(req.body);
    const validationError = validateProviderPayload(payload);
    if (validationError) return res.status(400).json({ error: validationError });

    const provider = await Provider.create(payload);
    await audit(req, 'provider.created', {
      targetType: 'provider',
      targetId: provider._id,
      message: 'Proveedor creado',
      metadata: { commercialName: provider.commercialName, stage: provider.stage, serviceType: provider.serviceType }
    });
    res.status(201).json({ ok: true, provider });
  } catch (e) {
    res.status(e.name === 'ValidationError' ? 400 : 500).json({ error: e.message });
  }
});

router.put('/providers/:id', async (req, res) => {
  try {
    const payload = cleanProviderBody(req.body);
    const validationError = validateProviderPayload(payload);
    if (validationError) return res.status(400).json({ error: validationError });

    const provider = await Provider.findByIdAndUpdate(req.params.id, payload, {
      new: true,
      runValidators: true
    });
    if (!provider) return res.status(404).json({ error: 'Proveedor no encontrado' });

    await audit(req, 'provider.updated', {
      targetType: 'provider',
      targetId: provider._id,
      message: 'Proveedor actualizado',
      metadata: { commercialName: provider.commercialName, stage: provider.stage, serviceType: provider.serviceType, isActive: provider.isActive }
    });
    res.json({ ok: true, provider });
  } catch (e) {
    res.status(e.name === 'ValidationError' ? 400 : 500).json({ error: e.message });
  }
});

router.patch('/providers/:id/active', async (req, res) => {
  try {
    const isActive = req.body?.isActive === true || req.body?.isActive === 'true';
    const provider = await Provider.findByIdAndUpdate(req.params.id, { isActive }, {
      new: true,
      runValidators: true
    });
    if (!provider) return res.status(404).json({ error: 'Proveedor no encontrado' });

    await audit(req, isActive ? 'provider.activated' : 'provider.deactivated', {
      targetType: 'provider',
      targetId: provider._id,
      status: isActive ? 'success' : 'info',
      message: isActive ? 'Proveedor activado' : 'Proveedor desactivado',
      metadata: { commercialName: provider.commercialName }
    });
    res.json({ ok: true, provider });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/providers/:id', async (req, res) => {
  try {
    const provider = await Provider.findByIdAndDelete(req.params.id);
    if (!provider) return res.status(404).json({ error: 'Proveedor no encontrado' });

    await audit(req, 'provider.deleted', {
      targetType: 'provider',
      targetId: provider._id,
      message: 'Proveedor eliminado',
      metadata: { commercialName: provider.commercialName, stage: provider.stage, serviceType: provider.serviceType }
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =========================================================================
   USUARIOS (Aprobación, bloqueo, listado)
   ========================================================================= */

/* =========================================================================
   MULTI-TENANT
   ========================================================================= */

router.get('/tenants', async (_req, res) => {
  try {
    const [tenantDocs, primaryTenantKeys, userTenantKeys] = await Promise.all([
      Tenant.find({}).sort({ name: 1, tenantKey: 1 }).lean(),
      User.distinct('tenantKey', { tenantKey: { $nin: [null, ''] } }),
      User.distinct('tenantKeys', { tenantKeys: { $nin: [null, ''] } })
    ]);

    const map = new Map();
    tenantDocs.forEach(t => map.set(t.tenantKey, {
      tenantKey: t.tenantKey,
      name: t.name || t.tenantKey,
      createdAt: t.createdAt || null,
      source: 'Tenant'
    }));
    [...primaryTenantKeys, ...userTenantKeys].filter(Boolean).forEach(key => {
      if (!map.has(key)) map.set(key, { tenantKey: key, name: key, createdAt: null, source: 'derived' });
    });

    const rows = await Promise.all(Array.from(map.values()).map(async t => {
      const { usersCount, projects } = await tenantAssignedProjects(t.tenantKey, '_id');
      return { ...t, usersCount, projectsCount: projects.length };
    }));

    res.json({ tenants: rows.sort((a, b) => String(a.name).localeCompare(String(b.name))) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/tenants/:tenantKey/users', async (req, res) => {
  try {
    const tenantKey = safeTenantKey(req.params.tenantKey);
    const users = await User.find(tenantUserFilter(tenantKey), { password: 0 })
      .sort({ createdAt: -1 })
      .lean();
    res.json({ tenantKey, users: users.map(u => sanitizeExportUser(u, tenantKey)) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/tenants/:tenantKey/projects', async (req, res) => {
  try {
    const tenantKey = safeTenantKey(req.params.tenantKey);
    const { projects } = await tenantAssignedProjects(tenantKey);
    res.json({ tenantKey, projects });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/tenants/:tenantKey/isolation', async (req, res) => {
  try {
    const tenantKey = safeTenantKey(req.params.tenantKey);
    const { projects } = await tenantAssignedProjects(tenantKey, '_id');
    const projectIds = projects.map(p => p._id);
    const noTenant = [{ tenantKey: { $exists: false } }, { tenantKey: null }, { tenantKey: '' }];
    const otherTenant = { $exists: true, $nin: [tenantKey, null, ''] };

    const [financeLeaks, unitLeaks, ventaLeaks, documentLeaks, checklistLeaks, permitLeaks, chatLeaks, legacy] = await Promise.all([
      ProjectFinance.countDocuments({ project: { $in: projectIds }, tenantKey: otherTenant }),
      Unit.countDocuments({ projectId: { $in: projectIds }, tenantKey: otherTenant }),
      Venta.countDocuments({ projectId: { $in: projectIds }, tenantKey: otherTenant }),
      Document.countDocuments({ projectId: { $in: projectIds }, tenantKey: otherTenant }),
      ProjectChecklist.countDocuments({ projectId: { $in: projectIds }, tenantKey: otherTenant }),
      ProjectPermit.countDocuments({ projectId: { $in: projectIds }, tenantKey: otherTenant }),
      ChatMessage.countDocuments({ projectId: { $in: projectIds }, tenantKey: otherTenant }),
      Promise.all([
        ProjectFinance.countDocuments({ project: { $in: projectIds }, $or: noTenant }),
        Unit.countDocuments({ projectId: { $in: projectIds }, $or: noTenant }),
        Venta.countDocuments({ projectId: { $in: projectIds }, $or: noTenant }),
        Document.countDocuments({ projectId: { $in: projectIds }, $or: noTenant }),
        ProjectChecklist.countDocuments({ projectId: { $in: projectIds }, $or: noTenant }),
        ProjectPermit.countDocuments({ projectId: { $in: projectIds }, $or: noTenant }),
        ChatMessage.countDocuments({ projectId: { $in: projectIds }, $or: noTenant })
      ])
    ]);

    const crossTenantFindings = { projectFinance: financeLeaks, units: unitLeaks, ventas: ventaLeaks, documents: documentLeaks, checklists: checklistLeaks, permits: permitLeaks, chats: chatLeaks };
    const legacyTenantlessFindings = { projectFinance: legacy[0], units: legacy[1], ventas: legacy[2], documents: legacy[3], checklists: legacy[4], permits: legacy[5], chats: legacy[6] };

    res.json({
      tenantKey,
      projectsCount: projectIds.length,
      ok: Object.values(crossTenantFindings).every(v => v === 0) && Object.values(legacyTenantlessFindings).every(v => v === 0),
      crossTenantFindings,
      legacyTenantlessFindings
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/tenants/:tenantKey/export', async (req, res) => {
  try {
    const tenantKey = safeTenantKey(req.params.tenantKey);
    const data = await collectTenantExport(tenantKey, req.user || {});
    await audit(req, 'tenant.export_json', {
      targetType: 'tenant',
      message: 'Exportacion JSON de tenant generada',
      metadata: { exportedTenantKey: tenantKey, counts: data.manifest.counts, physicalDocumentsIncluded: false }
    });
    const filename = `bank73-export-${tenantKey}-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(JSON.stringify(data, null, 2));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.delete('/tenants/:tenantKey', async (req, res) => {
  try {
    const tenantKey = safeTenantKey(req.params.tenantKey);
    const pin = String(req.body?.pin || '').trim();
    if (!tenantKey) return res.status(400).json({ error: 'Tenant invalido' });
    if (tenantKey === 'bancodemo') return res.status(403).json({ error: 'No se puede eliminar bancodemo.' });
    if (pin !== '258025') return res.status(403).json({ error: 'PIN incorrecto.' });

    const [primaryUsers, primaryProjects] = await Promise.all([
      User.countDocuments({ tenantKey }),
      Project.countDocuments({ tenantKey })
    ]);
    if (primaryUsers || primaryProjects) {
      return res.status(409).json({
        error: 'No se puede eliminar un tenant con usuarios o proyectos primarios. Migra esos registros antes.',
        primaryUsers,
        primaryProjects
      });
    }

    const [deleted, usersUpdated] = await Promise.all([
      Tenant.deleteOne({ tenantKey }),
      User.updateMany({ tenantKeys: tenantKey }, { $pull: { tenantKeys: tenantKey } })
    ]);

    await audit(req, 'tenant.delete', {
      targetType: 'tenant',
      message: 'Tenant eliminado',
      metadata: {
        deletedTenantKey: tenantKey,
        tenantDeleted: deleted.deletedCount || 0,
        usersUpdated: usersUpdated.modifiedCount || 0
      }
    });

    res.json({
      ok: true,
      tenantKey,
      tenantDeleted: deleted.deletedCount || 0,
      usersUpdated: usersUpdated.modifiedCount || 0
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ROLE-SEP: GET /api/admin/users?status=pending   -> lista de usuarios del tenant (filtrable por status)
router.get('/users', async (req, res) => {
  try {
    const q = { $or: [{ tenantKey: req.tenantKey }, { tenantKeys: req.tenantKey }] };
    if (req.query.status) q.status = req.query.status; // e.g., pending, active, blocked
    const users = await User.find(q, { password: 0 }).sort({ createdAt: -1 });
    res.json({ users });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/admin/users/:id/approve  -> activa y asigna rol (si se envía)
router.post('/users/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const desiredRole = String(req.body?.role || '').trim().toLowerCase();

    const user = await User.findOne({ _id: id, tenantKey: req.tenantKey });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    // Si no se manda role, usamos el roleRequested; ambos normalizados
    const finalRole = desiredRole || String(user.roleRequested || '').toLowerCase() || 'bank';
    const wasPending = user.status !== 'active';

    if (!VALID_ROLES.includes(finalRole)) {
      return res.status(400).json({ error: 'Rol inválido' });
    }

    user.role = finalRole;
    user.status = 'active';
    user.verified = true;          // (opcional si lo usas)
    user.roleRequested = null;     // limpiar para evitar confusiones
    user.tenantKeys = sanitizeTenantKeys(user.tenantKeys, user.tenantKey, { includeFallback: wasPending });
    await user.save();

    await audit(req, 'user.approved', {
      targetType: 'user',
      targetId: user._id,
      message: 'Usuario aprobado',
      metadata: { email: user.email, role: user.role, name: user.name }
    });

    res.json({
      ok: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        tenantKey: user.tenantKey,
        tenantKeys: user.tenantKeys || []
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/users/:id/promoter-profile', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findOne({
      _id: id,
      $or: [{ tenantKey: req.tenantKey }, { tenantKeys: req.tenantKey }]
    });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    user.promoterProfile = sanitizePromoterProfileShared(req.body?.promoterProfile || req.body?.perfilPromotor || req.body || {}, { strictNumbers: true });
    await user.save();

    await audit(req, 'user.promoter_profile_updated', {
      targetType: 'user',
      targetId: user._id,
      message: 'Perfil del promotor actualizado',
      metadata: { email: user.email, role: user.role, promoterCategory: user.promoterCategory }
    });

    res.json({
      ok: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        roleRequested: user.roleRequested,
        status: user.status,
        tenantKey: user.tenantKey,
        promoterProfile: user.promoterProfile || null,
        promoterCategory: user.promoterCategory || 'No definido',
        promoterProfileCompletion: promoterProfileCompletion(user.promoterProfile || {})
      }
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

router.patch('/users/:id/tenants', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await User.findOne({
      _id: id,
      $or: [{ tenantKey: req.tenantKey }, { tenantKeys: req.tenantKey }]
    });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    const hasBankPayload = Array.isArray(req.body?.banks) || Array.isArray(req.body?.bankTenants);
    const bankTenantKeys = await ensureBankTenants(req.body?.banks || req.body?.bankTenants || []);
    const tenantKeysRaw = hasBankPayload
      ? Array.from(new Set(bankTenantKeys))
      : sanitizeTenantKeys(req.body?.tenantKeys, user.tenantKey);
    const tenantKeys = tenantKeysRaw.filter(key => String(key || '').trim() !== 'bancodemo');
    user.tenantKeys = tenantKeys;
    await user.save();

    await audit(req, 'user.tenants_updated', {
      targetType: 'user',
      targetId: user._id,
      message: 'Bancos/tenants asignados al usuario',
      metadata: { email: user.email, role: user.role, tenantKeys }
    });

    res.json({
      ok: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        tenantKey: user.tenantKey,
        tenantKeys: user.tenantKeys || []
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ROLE-SEP: POST /api/admin/users/:id/block -> pone status:'blocked'
router.post('/users/:id/block', async (req, res) => {
  try {
    const { id } = req.params;

    // Evitar que un admin se bloquee a sí mismo
    if (id === req.user.userId) {
      return res.status(400).json({ error: 'No puedes bloquear tu propia cuenta de admin.' });
    }

    const user = await User.findOne({ _id: id, tenantKey: req.tenantKey });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    user.status = 'blocked'; // ROLE-SEP
    await user.save();

    await audit(req, 'user.blocked', {
      targetType: 'user',
      targetId: user._id,
      status: 'blocked',
      message: 'Usuario bloqueado',
      metadata: { email: user.email, role: user.role, name: user.name }
    });

    res.json({
      ok: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        tenantKey: user.tenantKey
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/users/:id/unblock', async (req, res) => {
  try {
    const { id } = req.params;

    const user = await User.findOne({ _id: id, tenantKey: req.tenantKey });
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });

    user.status = 'active';
    await user.save();

    await audit(req, 'user.unblocked', {
      targetType: 'user',
      targetId: user._id,
      status: 'info',
      message: 'Usuario desbloqueado',
      metadata: { email: user.email, role: user.role, name: user.name }
    });

    res.json({
      ok: true,
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        status: user.status,
        tenantKey: user.tenantKey,
        tenantKeys: user.tenantKeys || []
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// (Mantenida) GET /api/admin/users  -> lista de usuarios del tenant (ya cubierta arriba con filtro opcional)

// (Mantenida) DELETE /api/admin/users/:id -> elimina un usuario del tenant
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Evitar que un admin se elimine a sí mismo
    if (id === req.user.userId) {
      return res.status(400).json({ error: 'No puedes eliminar tu propia cuenta de admin.' });
    }

    const deleted = await User.findOneAndDelete({ _id: id, tenantKey: req.tenantKey });
    if (!deleted) return res.status(404).json({ error: 'Usuario no encontrado' });

    await audit(req, 'user.deleted', {
      targetType: 'user',
      targetId: deleted._id,
      message: 'Usuario eliminado',
      metadata: { email: deleted.email, role: deleted.role, name: deleted.name, status: deleted.status }
    });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =========================================================================
   PROYECTOS (Aprobación de publicación)
   ========================================================================= */

// ROLE-SEP: GET /api/admin/projects?status=pending
// Lista proyectos del tenant filtrando por publishStatus (draft|pending|approved|rejected).
router.get('/projects', async (req, res) => {
  try {
    const q = { tenantKey: req.tenantKey };
    const status = (req.query.status || '').toLowerCase();
    if (status) {
      if (!VALID_PUBLISH.includes(status)) {
        return res.status(400).json({ error: 'publishStatus inválido' });
      }
      q.publishStatus = status; // ROLE-SEP
    }
    const projects = await Project.find(q).sort({ createdAt: -1 }).lean();
    res.json({ projects: projects.map(p => ({ ...p, tipoProyecto: p.projectType || '' })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ROLE-SEP: POST /api/admin/projects/:id/approve -> publishStatus:'approved'
router.post('/projects/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const proj = await Project.findOne({ _id: id, tenantKey: req.tenantKey });
    if (!proj) return res.status(404).json({ error: 'Proyecto no encontrado' });

    proj.publishStatus = 'approved'; // ROLE-SEP
    await proj.save();

    await audit(req, 'project.approved', {
      targetType: 'project',
      targetId: proj._id,
      projectId: proj._id,
      message: 'Proyecto aprobado',
      metadata: { name: proj.name, publishStatus: proj.publishStatus }
    });

    res.json({ ok: true, project: proj });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ROLE-SEP: POST /api/admin/projects/:id/reject -> publishStatus:'rejected'
router.post('/projects/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const proj = await Project.findOne({ _id: id, tenantKey: req.tenantKey });
    if (!proj) return res.status(404).json({ error: 'Proyecto no encontrado' });

    proj.publishStatus = 'rejected'; // ROLE-SEP
    await proj.save();

    await audit(req, 'project.rejected', {
      targetType: 'project',
      targetId: proj._id,
      projectId: proj._id,
      status: 'blocked',
      message: 'Proyecto rechazado',
      metadata: { name: proj.name, publishStatus: proj.publishStatus }
    });

    res.json({ ok: true, project: proj });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
