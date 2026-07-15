const express = require('express');
const Provider = require('../models/Provider');
const ProviderRequest = require('../models/ProviderRequest');
const Project = require('../models/Project');
const audit = require('../utils/audit');
const { moduleEnabled } = require('../services/moduleSettings');

const router = express.Router();

function buildProviderFilter(query = {}) {
  const filter = { isActive: true };
  const stage = String(query.stage || '').trim();
  const serviceType = String(query.serviceType || query.service || '').trim();
  if (stage) filter.stage = stage;
  if (serviceType) filter.serviceType = serviceType;
  return filter;
}

function userId(req) {
  return req.user?._id || req.user?.userId || req.user?.id;
}

function includesId(list, id) {
  if (!Array.isArray(list) || !id) return false;
  return list.some(item => String(item) === String(id));
}

function canRequestForProject(req, project) {
  const role = String(req.user?.role || '').toLowerCase().trim();
  if (role === 'admin' || role === 'bank') return true;
  if (!project || String(project.tenantKey || '') !== String(req.tenantKey || req.user?.tenantKey || '')) return false;
  const uid = userId(req);
  const assignees = project.assignees || {};
  const pools = [
    project.assignedPromoters,
    project.assignedCommercials,
    project.assignedBanks,
    project.assignedLegal,
    project.assignedTecnicos,
    project.assignedGerencia,
    project.assignedSocios,
    project.assignedFinanciero,
    project.assignedContable,
    assignees.promoter,
    assignees.commercial,
    assignees.bank,
    assignees.legal,
    assignees.tecnico,
    assignees.gerencia,
    assignees.socios,
    assignees.financiero,
    assignees.contable
  ];
  return pools.some(list => includesId(list, uid));
}

router.get('/', async (req, res) => {
  try {
    if (!(await moduleEnabled('providers'))) {
      return res.status(403).json({ error: 'Módulo Proveedores desactivado' });
    }
    const providers = await Provider.find(buildProviderFilter(req.query))
      .sort({ stage: 1, serviceType: 1, commercialName: 1 })
      .lean();
    res.json({ providers });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/module-settings', async (_req, res) => {
  try {
    res.json({ enabled: await moduleEnabled('providers') });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.post('/:providerId/requests', async (req, res) => {
  try {
    if (!(await moduleEnabled('providers'))) {
      return res.status(403).json({ error: 'Módulo Proveedores desactivado' });
    }
    const provider = await Provider.findOne({ _id: req.params.providerId, isActive: true });
    if (!provider) return res.status(404).json({ error: 'Proveedor no encontrado' });

    const projectId = String(req.body?.projectId || '').trim();
    const project = await Project.findById(projectId).lean();
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });
    if (!canRequestForProject(req, project)) return res.status(403).json({ error: 'Proyecto no autorizado' });

    const request = await ProviderRequest.create({
      provider: provider._id,
      project: project._id,
      requestedBy: userId(req),
      serviceType: provider.serviceType,
      comments: String(req.body?.comments || '').trim().slice(0, 1200)
    });

    await audit(req, 'provider_request.created', {
      targetType: 'provider',
      targetId: provider._id,
      projectId: project._id,
      message: 'Solicitud de presupuesto registrada',
      metadata: { provider: provider.commercialName, serviceType: provider.serviceType }
    });

    res.status(201).json({ ok: true, request });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
