const express = require('express');
const router = express.Router();
const ProjectBudgetLine = require('../models/ProjectBudgetLine');
const CommercialFolder = require('../models/CommercialFolder');
const Project = require('../models/Project');
const { requireProjectAccess } = require('../middleware/rbac');

async function attachProjectFromRequest(req, res, next) {
  try {
    const projectId = req.body?.projectId || req.query?.projectId;
    if (!projectId) return res.status(400).json({ error: 'projectId requerido' });

    const project = await Project.findOne({ _id: projectId, tenantKey: req.tenantKey }).lean();
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    req.project = project;
    next();
  } catch {
    res.status(400).json({ error: 'projectId invalido' });
  }
}

async function attachProjectFromLine(req, res, next) {
  try {
    const line = await ProjectBudgetLine.findOne({ _id: req.params.id, tenantKey: req.tenantKey }).lean();
    if (!line) return res.status(404).json({ error: 'Partida no encontrada' });

    const project = await Project.findOne({ _id: line.projectId, tenantKey: req.tenantKey }).lean();
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    req.project = project;
    req.budgetLine = line;
    next();
  } catch {
    res.status(400).json({ error: 'id invalido' });
  }
}

// Lista las partidas activas de un proyecto, agrupadas implícitamente por
// commercialFolderId (Torre/Etapa reutilizada del módulo comercial).
router.get('/', requireProjectAccess(), attachProjectFromRequest, async (req, res) => {
  const { projectId } = req.query;

  const filter = { projectId, isActive: true };
  if (req.tenantKey) filter.tenantKey = req.tenantKey;

  const budgetLines = await ProjectBudgetLine.find(filter)
    .sort({ commercialFolderId: 1, order: 1, createdAt: 1 })
    .lean();

  res.json({ budgetLines });
});

router.post('/', attachProjectFromRequest, requireProjectAccess({ promoterCanEditAssigned: true }), async (req, res) => {
  const { projectId, commercialFolderId, name, code, category, order } = req.body;

  if (!projectId || !commercialFolderId || !name) {
    return res.status(400).json({ error: 'projectId, commercialFolderId y name requeridos' });
  }

  if (category && !ProjectBudgetLine.CATEGORIES.includes(category)) {
    return res.status(400).json({ error: 'category invalida' });
  }

  const folder = await CommercialFolder.findOne({
    _id: commercialFolderId,
    tenantKey: req.tenantKey,
    projectId
  }).select('_id').lean();
  if (!folder) return res.status(404).json({ error: 'Torre/Etapa (carpeta comercial) no encontrada' });

  const count = await ProjectBudgetLine.countDocuments({ tenantKey: req.tenantKey, projectId, commercialFolderId });

  const budgetLine = await ProjectBudgetLine.create({
    tenantKey: req.tenantKey,
    projectId,
    commercialFolderId,
    category: category || 'infraestructura',
    code: String(code || '').trim(),
    name: name.trim(),
    order: Number.isFinite(Number(order)) ? Number(order) : count
  });

  res.status(201).json({ budgetLine });
});

router.patch('/:id', attachProjectFromLine, requireProjectAccess({ promoterCanEditAssigned: true }), async (req, res) => {
  const update = {};

  if (req.body.name != null) update.name = String(req.body.name || '').trim();
  if (req.body.code != null) update.code = String(req.body.code || '').trim();
  if (req.body.order != null && Number.isFinite(Number(req.body.order))) update.order = Number(req.body.order);
  if (req.body.isActive != null) update.isActive = !!req.body.isActive;

  if (req.body.category != null) {
    if (!ProjectBudgetLine.CATEGORIES.includes(req.body.category)) {
      return res.status(400).json({ error: 'category invalida' });
    }
    update.category = req.body.category;
  }

  if (req.body.commercialFolderId != null) {
    const folder = await CommercialFolder.findOne({
      _id: req.body.commercialFolderId,
      tenantKey: req.tenantKey,
      projectId: req.budgetLine.projectId
    }).select('_id').lean();
    if (!folder) return res.status(404).json({ error: 'Torre/Etapa (carpeta comercial) no encontrada' });
    update.commercialFolderId = req.body.commercialFolderId;
  }

  const budgetLine = await ProjectBudgetLine.findOneAndUpdate(
    { _id: req.params.id, tenantKey: req.tenantKey },
    update,
    { new: true }
  );

  if (!budgetLine) return res.status(404).json({ error: 'Partida no encontrada' });

  res.json({ budgetLine });
});

// Baja lógica: una partida referenciada por inspecciones pasadas no se borra
// físicamente (el histórico ya guarda su propio snapshot del nombre).
router.delete('/:id', attachProjectFromLine, requireProjectAccess({ promoterCanEditAssigned: true }), async (req, res) => {
  const budgetLine = await ProjectBudgetLine.findOneAndUpdate(
    { _id: req.params.id, tenantKey: req.tenantKey },
    { isActive: false },
    { new: true }
  );

  if (!budgetLine) return res.status(404).json({ error: 'Partida no encontrada' });

  res.json({ ok: true });
});

module.exports = router;
