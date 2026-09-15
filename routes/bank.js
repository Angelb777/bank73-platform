const express = require('express');
const Project = require('../models/Project');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const Document = require('../models/Document');
const Milestone = require('../models/Milestone');
const ProjectAvaluatorAssignment = require('../models/ProjectAvaluatorAssignment');
const AvaluationTemplate = require('../models/AvaluationTemplate');
const { requireRole } = require('../middleware/rbac');
const { hashPassword } = require('../utils/passwords');
const audit = require('../utils/audit');
const mongoose = require('mongoose');

const router = express.Router();

function idsFromProject(project) {
  return [
    project.createdBy,
    ...(project.assignedPromoters || []),
    ...(project.assignedCommercials || []),
    ...(project.assignedBanks || []),
    ...(project.assignedLegal || []),
    ...(project.assignedTecnicos || []),
    ...(project.assignedGerencia || []),
    ...(project.assignedSocios || []),
    ...(project.assignedFinanciero || []),
    ...(project.assignedContable || [])
  ].filter(Boolean).map(String);
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

function bankTenantKeyFromSession(req) {
  const activeTenantKey = String(req.tenantKey || '').trim();
  const assignedTenants = Array.isArray(req.user?.tenantKeys)
    ? req.user.tenantKeys.map(value => String(value || '').trim()).filter(Boolean)
    : [];

  return activeTenantKey && assignedTenants.includes(activeTenantKey)
    ? activeTenantKey
    : '';
}

function publicAvaluator(user) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    status: user.status,
    tenantKey: user.tenantKey,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function avaluationTemplateDto(template) {
  return {
    id: String(template._id),
    name: String(template.name || ''),
    version: Number(template.version),
    status: String(template.status || ''),
    sections: (template.sections || [])
      .map(section => ({
        key: String(section.key || ''),
        name: String(section.name || ''),
        weight: Number(section.weight),
        order: Number(section.order)
      }))
      .sort((a, b) => a.order - b.order),
    createdAt: template.createdAt,
    updatedAt: template.updatedAt
  };
}

function parseTemplateSections(value) {
  if (!Array.isArray(value) || !value.length || value.length > 100) return null;

  const sections = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const unexpected = Object.keys(raw).filter(key => !['key', 'name', 'weight', 'order'].includes(key));
    if (unexpected.length) return null;
    const key = String(raw.key || '').trim().toLowerCase();
    const name = String(raw.name || '').trim();
    const weight = Number(raw.weight);
    const order = Number(raw.order);
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(key) || !name || name.length > 180) return null;
    if (!Number.isFinite(weight) || weight < 0 || weight > 100) return null;
    if (!Number.isInteger(order) || order < 0) return null;
    sections.push({ key, name, weight, order });
  }

  const keys = sections.map(section => section.key);
  const orders = sections.map(section => section.order);
  const totalWeight = sections.reduce((sum, section) => sum + section.weight, 0);
  if (new Set(keys).size !== keys.length || new Set(orders).size !== orders.length) return null;
  if (Math.abs(totalWeight - 100) >= 0.000001) return null;
  return sections.sort((a, b) => a.order - b.order);
}

async function findVisibleProjectForBank(req, projectId) {
  if (!mongoose.Types.ObjectId.isValid(String(projectId || ''))) return null;

  const bankTenantKey = bankTenantKeyFromSession(req);
  if (!bankTenantKey) return null;

  const tenantUsers = await User.find({
    $or: [{ tenantKey: bankTenantKey }, { tenantKeys: bankTenantKey }]
  }).select('_id').lean();
  const tenantUserIds = tenantUsers.map(user => user._id);
  const scope = [{ tenantKey: bankTenantKey }];
  if (tenantUserIds.length) scope.push(projectAssignedToUsersFilter(tenantUserIds));

  return Project.findOne({
    _id: projectId,
    publishStatus: 'approved',
    $or: scope
  }).lean();
}

// Gestion bancaria limitada exclusivamente a usuarios avaluador.
router.get('/avaluadores', requireRole('bank'), async (req, res) => {
  try {
    const bankTenantKey = bankTenantKeyFromSession(req);
    if (!bankTenantKey) return res.status(403).json({ error: 'No tienes un tenant bancario activo.' });

    const users = await User.find({ tenantKey: bankTenantKey, role: 'avaluador' }, { password: 0 })
      .sort({ name: 1, email: 1 })
      .lean();
    res.json({ tenantKey: bankTenantKey, users: users.map(publicAvaluator) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/avaluadores', requireRole('bank'), async (req, res) => {
  try {
    const bankTenantKey = bankTenantKeyFromSession(req);
    if (!bankTenantKey) return res.status(403).json({ error: 'No tienes un tenant bancario activo.' });

    const name = String(req.body?.name || '').trim().slice(0, 180);
    const email = String(req.body?.email || '').trim().toLowerCase().slice(0, 254);
    const password = String(req.body?.password || req.body?.temporaryPassword || '');
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'name, email y password son requeridos.' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ error: 'Email invalido.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'La password temporal debe tener al menos 8 caracteres.' });
    }

    const exists = await User.findOne({
      email,
      $or: [{ tenantKey: bankTenantKey }, { tenantKeys: bankTenantKey }]
    }).select('_id').lean();
    if (exists) return res.status(409).json({ error: 'El email ya esta registrado en este banco.' });

    const user = await User.create({
      tenantKey: bankTenantKey,
      tenantKeys: [bankTenantKey],
      name,
      email,
      password: hashPassword(password),
      role: 'avaluador',
      roleRequested: null,
      status: 'pending'
    });

    await audit(req, 'avaluador.created', {
      tenantKey: bankTenantKey,
      targetType: 'user',
      targetId: user._id,
      message: 'Avaluador creado por el banco',
      metadata: { email: user.email, status: user.status }
    });

    res.status(201).json({ ok: true, user: publicAvaluator(user) });
  } catch (e) {
    if (e?.code === 11000) return res.status(409).json({ error: 'El email ya esta registrado en este banco.' });
    res.status(e?.name === 'ValidationError' ? 400 : 500).json({ error: e.message });
  }
});

router.patch('/avaluadores/:id/status', requireRole('bank'), async (req, res) => {
  try {
    const bankTenantKey = bankTenantKeyFromSession(req);
    if (!bankTenantKey) return res.status(403).json({ error: 'No tienes un tenant bancario activo.' });

    const status = String(req.body?.status || '').toLowerCase();
    if (!['active', 'blocked'].includes(status)) {
      return res.status(400).json({ error: 'status debe ser active o blocked.' });
    }

    const user = await User.findOne({
      _id: req.params.id,
      tenantKey: bankTenantKey,
      role: 'avaluador'
    });
    if (!user) return res.status(404).json({ error: 'Avaluador no encontrado.' });

    user.status = status;
    await user.save();
    await audit(req, status === 'active' ? 'avaluador.activated' : 'avaluador.blocked', {
      tenantKey: bankTenantKey,
      targetType: 'user',
      targetId: user._id,
      status: status === 'blocked' ? 'blocked' : 'success',
      message: status === 'active' ? 'Avaluador activado por el banco' : 'Avaluador bloqueado por el banco',
      metadata: { email: user.email }
    });

    res.json({ ok: true, user: publicAvaluator(user) });
  } catch (e) {
    res.status(e?.name === 'CastError' ? 404 : 500).json({ error: e.message });
  }
});

router.get('/projects/:projectId/avaluadores', requireRole('bank'), async (req, res) => {
  try {
    const bankTenantKey = bankTenantKeyFromSession(req);
    const project = await findVisibleProjectForBank(req, req.params.projectId);
    if (!bankTenantKey || !project) return res.status(404).json({ error: 'Proyecto no encontrado.' });

    const assignments = await ProjectAvaluatorAssignment.find({
      bankTenantKey,
      projectId: project._id,
      projectTenantKey: project.tenantKey,
      status: 'active'
    })
      .populate('avaluadorId', 'name email role status tenantKey')
      .sort({ assignedAt: -1 })
      .lean();

    res.json({
      bankTenantKey,
      projectTenantKey: project.tenantKey,
      projectId: project._id,
      assignments
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.put('/projects/:projectId/avaluadores/:avaluadorId', requireRole('bank'), async (req, res) => {
  try {
    const bankTenantKey = bankTenantKeyFromSession(req);
    const project = await findVisibleProjectForBank(req, req.params.projectId);
    if (!bankTenantKey || !project) return res.status(404).json({ error: 'Proyecto no encontrado.' });

    const avaluador = await User.findOne({
      _id: req.params.avaluadorId,
      tenantKey: bankTenantKey,
      role: 'avaluador',
      status: 'active'
    }).select('_id name email role status tenantKey').lean();
    if (!avaluador) return res.status(404).json({ error: 'Avaluador activo no encontrado en este banco.' });

    const now = new Date();
    const assignment = await ProjectAvaluatorAssignment.findOneAndUpdate(
      { bankTenantKey, projectId: project._id, avaluadorId: avaluador._id },
      {
        $set: {
          projectTenantKey: project.tenantKey,
          status: 'active',
          assignedBy: req.user.userId,
          assignedAt: now,
          revokedBy: null,
          revokedAt: null
        },
        $setOnInsert: { bankTenantKey, projectId: project._id, avaluadorId: avaluador._id }
      },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    );

    await audit(req, 'avaluador.project_assigned', {
      tenantKey: bankTenantKey,
      targetType: 'project',
      targetId: project._id,
      projectId: project._id,
      message: 'Avaluador asignado al proyecto',
      metadata: {
        avaluadorId: avaluador._id,
        projectTenantKey: project.tenantKey
      }
    });

    res.json({ ok: true, assignment, avaluador });
  } catch (e) {
    res.status(e?.name === 'CastError' ? 404 : 500).json({ error: e.message });
  }
});

router.delete('/projects/:projectId/avaluadores/:avaluadorId', requireRole('bank'), async (req, res) => {
  try {
    const bankTenantKey = bankTenantKeyFromSession(req);
    if (!bankTenantKey) return res.status(403).json({ error: 'No tienes un tenant bancario activo.' });

    const avaluador = await User.findOne({
      _id: req.params.avaluadorId,
      tenantKey: bankTenantKey,
      role: 'avaluador'
    }).select('_id').lean();
    if (!avaluador) return res.status(404).json({ error: 'Avaluador no encontrado.' });

    const assignment = await ProjectAvaluatorAssignment.findOneAndUpdate(
      {
        bankTenantKey,
        projectId: req.params.projectId,
        avaluadorId: avaluador._id,
        status: 'active'
      },
      {
        $set: {
          status: 'revoked',
          revokedBy: req.user.userId,
          revokedAt: new Date()
        }
      },
      { new: true, runValidators: true }
    );
    if (!assignment) return res.status(404).json({ error: 'Asignacion activa no encontrada.' });

    await audit(req, 'avaluador.project_revoked', {
      tenantKey: bankTenantKey,
      targetType: 'project',
      targetId: assignment.projectId,
      projectId: assignment.projectId,
      status: 'info',
      message: 'Asignacion de avaluador revocada',
      metadata: {
        avaluadorId: avaluador._id,
        projectTenantKey: assignment.projectTenantKey
      }
    });

    res.json({ ok: true, assignment });
  } catch (e) {
    res.status(e?.name === 'CastError' ? 404 : 500).json({ error: e.message });
  }
});

router.get('/avaluation-templates', requireRole('bank'), async (req, res) => {
  try {
    const bankTenantKey = bankTenantKeyFromSession(req);
    if (!bankTenantKey) return res.status(403).json({ error: 'No tienes un tenant bancario activo.' });

    const templates = await AvaluationTemplate.find({ bankTenantKey })
      .sort({ version: -1 })
      .lean();
    res.json({ templates: templates.map(avaluationTemplateDto) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/avaluation-templates', requireRole('bank'), async (req, res) => {
  try {
    const bankTenantKey = bankTenantKeyFromSession(req);
    if (!bankTenantKey) return res.status(403).json({ error: 'No tienes un tenant bancario activo.' });
    const unexpected = Object.keys(req.body || {}).filter(key => !['name', 'sections'].includes(key));
    if (unexpected.length) return res.status(400).json({ error: 'Campos no permitidos.', fields: unexpected });

    const name = String(req.body?.name || '').trim();
    const sections = parseTemplateSections(req.body?.sections);
    if (!name || name.length > 180 || !sections) {
      return res.status(400).json({
        error: 'name y sections validas son requeridos; keys y orders deben ser unicos y los pesos sumar 100.'
      });
    }

    const latest = await AvaluationTemplate.findOne({ bankTenantKey })
      .sort({ version: -1 })
      .select('version')
      .lean();
    const template = await AvaluationTemplate.create({
      bankTenantKey,
      name,
      version: Number(latest?.version || 0) + 1,
      status: 'draft',
      sections,
      createdBy: req.user.userId
    });

    await audit(req, 'avaluation_template.created', {
      tenantKey: bankTenantKey,
      targetType: 'avaluation_template',
      targetId: template._id,
      message: 'Version de metodologia de avaluacion creada',
      metadata: { version: template.version, name: template.name }
    });
    res.status(201).json({ template: avaluationTemplateDto(template) });
  } catch (e) {
    if (e?.code === 11000) return res.status(409).json({ error: 'Conflicto al crear la version de la plantilla.' });
    res.status(e?.name === 'ValidationError' ? 400 : 500).json({ error: e.message });
  }
});

router.get('/avaluation-templates/:id', requireRole('bank'), async (req, res) => {
  try {
    const bankTenantKey = bankTenantKeyFromSession(req);
    if (!bankTenantKey || !mongoose.Types.ObjectId.isValid(String(req.params.id || ''))) {
      return res.status(404).json({ error: 'Plantilla no encontrada.' });
    }
    const template = await AvaluationTemplate.findOne({ _id: req.params.id, bankTenantKey }).lean();
    if (!template) return res.status(404).json({ error: 'Plantilla no encontrada.' });
    res.json({ template: avaluationTemplateDto(template) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.patch('/avaluation-templates/:id/activate', requireRole('bank'), async (req, res) => {
  try {
    const bankTenantKey = bankTenantKeyFromSession(req);
    if (!bankTenantKey || !mongoose.Types.ObjectId.isValid(String(req.params.id || ''))) {
      return res.status(404).json({ error: 'Plantilla no encontrada.' });
    }
    const target = await AvaluationTemplate.findOne({ _id: req.params.id, bankTenantKey }).lean();
    if (!target) return res.status(404).json({ error: 'Plantilla no encontrada.' });
    if (!parseTemplateSections(target.sections)) {
      return res.status(400).json({ error: 'La plantilla no tiene una metodologia valida con pesos que sumen 100.' });
    }

    if (target.status !== 'active') {
      await AvaluationTemplate.updateMany(
        { bankTenantKey, status: 'active', _id: { $ne: target._id } },
        { $set: { status: 'retired' } }
      );
    }
    const template = target.status === 'active'
      ? target
      : await AvaluationTemplate.findOneAndUpdate(
          { _id: target._id, bankTenantKey },
          { $set: { status: 'active' } },
          { new: true, runValidators: true }
        ).lean();

    await audit(req, 'avaluation_template.activated', {
      tenantKey: bankTenantKey,
      targetType: 'avaluation_template',
      targetId: target._id,
      message: 'Metodologia de avaluacion activada',
      metadata: { version: target.version, name: target.name }
    });
    res.json({ template: avaluationTemplateDto(template) });
  } catch (e) {
    if (e?.code === 11000) return res.status(409).json({ error: 'Ya existe otra plantilla activa.' });
    res.status(e?.name === 'ValidationError' ? 400 : 500).json({ error: e.message });
  }
});

router.get('/dashboard', requireRole('bank'), async (req, res) => {
  try {
    const tenantKeys = Array.isArray(req.user?.tenantKeys)
      ? Array.from(new Set(req.user.tenantKeys.map(v => String(v || '').trim()).filter(Boolean)))
      : [];
    const activeTenantKey = String(req.tenantKey || '').trim();

    if (!activeTenantKey || !tenantKeys.includes(activeTenantKey)) {
      return res.status(403).json({ error: 'No tienes tenants asignados.' });
    }

    const tenantFilter = activeTenantKey;
    const tenantUsers = await User.find(
      { $or: [{ tenantKey: tenantFilter }, { tenantKeys: tenantFilter }] },
      { password: 0 }
    ).sort({ role: 1, name: 1, email: 1 }).limit(100).lean();

    const tenantUserIds = tenantUsers.map(user => user._id);
    const projectScope = tenantUserIds.length
      ? {
          $or: [
            { tenantKey: tenantFilter },
            projectAssignedToUsersFilter(tenantUserIds)
          ]
        }
      : { tenantKey: tenantFilter };

    const projects = await Project.find(projectScope)
      .sort({ updatedAt: -1, createdAt: -1 })
      .lean();

    const projectIds = projects.map(project => project._id);
    const projectTenantKeys = Array.from(new Set(projects.map(project => String(project.tenantKey || '').trim()).filter(Boolean)));
    const projectTenantFilter = projectTenantKeys.length ? { $in: projectTenantKeys } : tenantFilter;
    const relatedUserIds = Array.from(new Set(projects.flatMap(idsFromProject)));

    const [relatedUsers, logs, documentsCount, milestones] = await Promise.all([
      relatedUserIds.length
        ? User.find({
            _id: { $in: relatedUserIds },
            $or: [{ tenantKey: projectTenantFilter }, { tenantKeys: projectTenantFilter }]
          }, { password: 0 }).lean()
        : [],
      AuditLog.find({ tenantKey: req.tenantKey }).sort({ createdAt: -1 }).limit(50).lean(),
      projectIds.length ? Document.countDocuments({ tenantKey: projectTenantFilter, projectId: { $in: projectIds } }) : 0,
      projectIds.length
        ? Milestone.find({ tenantKey: projectTenantFilter, projectId: { $in: projectIds } }).sort({ createdAt: -1 }).limit(20).lean()
        : []
    ]);

    const projectUsersById = new Map();
    [...tenantUsers, ...relatedUsers].forEach(user => projectUsersById.set(String(user._id), user));

    res.json({
      tenantKey: activeTenantKey,
      tenantKeys,
      projects,
      users: tenantUsers,
      projectUsers: Array.from(projectUsersById.values()),
      logs,
      alerts: milestones,
      metrics: {
        projects: projects.length,
        users: tenantUsers.length,
        documents: documentsCount,
        alerts: milestones.length
      }
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
