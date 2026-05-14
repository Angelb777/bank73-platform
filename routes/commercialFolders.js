const express = require('express');
const router = express.Router();
const CommercialFolder = require('../models/CommercialFolder');
const Unit = require('../models/Unit');
const Project = require('../models/Project');

router.get('/', async (req, res) => {
  const { projectId } = req.query;

  const filter = { projectId };
  if (req.tenantKey) filter.tenantKey = req.tenantKey;

  const folders = await CommercialFolder.find(filter)
    .sort({ order: 1, createdAt: 1 })
    .lean();

  const projectFilter = { _id: projectId };
  if (req.tenantKey) projectFilter.tenantKey = req.tenantKey;

  const project = await Project.findOne(projectFilter)
    .select('commercialUnassignedName commercialUnassignedColor')
    .lean();

  res.json({
    folders,
    unassigned: {
      name: project?.commercialUnassignedName || 'Sin carpeta',
      color: project?.commercialUnassignedColor || '#0f172a'
    }
  });
});

router.post('/', async (req, res) => {
  const { projectId, name, color } = req.body;

  if (!projectId || !name) {
    return res.status(400).json({ error: 'projectId y name requeridos' });
  }

  const count = await CommercialFolder.countDocuments({ projectId });

  const folder = await CommercialFolder.create({
    tenantKey: req.tenantKey,
    projectId,
    name: name.trim(),
    color: color || '#0f172a',
    order: count
  });

  res.json(folder);
});

router.patch('/unassigned/settings', async (req, res) => {
  const { projectId, name, color } = req.body;

  if (!projectId) {
    return res.status(400).json({ error: 'projectId requerido' });
  }

  const update = {};

  if (name != null) {
    update.commercialUnassignedName = String(name || '').trim() || 'Sin carpeta';
  }

  if (color != null) {
    update.commercialUnassignedColor = String(color || '').trim() || '#0f172a';
  }

  const filter = { _id: projectId };
  if (req.tenantKey) filter.tenantKey = req.tenantKey;

  const project = await Project.findOneAndUpdate(
    filter,
    { $set: update },
    { new: true }
  ).lean();

  if (!project) {
    return res.status(404).json({ error: 'Proyecto no encontrado' });
  }

  res.json({
    ok: true,
    name: project.commercialUnassignedName || 'Sin carpeta',
    color: project.commercialUnassignedColor || '#0f172a'
  });
});

router.patch('/:id', async (req, res) => {
  const update = {};

  if (req.body.name != null) {
    update.name = String(req.body.name || '').trim();
  }

  if (req.body.color != null) {
    update.color = String(req.body.color || '#0f172a').trim();
  }

  const folder = await CommercialFolder.findByIdAndUpdate(
    req.params.id,
    update,
    { new: true }
  );

  res.json(folder);
});

router.delete('/:id', async (req, res) => {
  const folderId = req.params.id;

  await Unit.updateMany(
    { folderId },
    { $set: { folderId: null, folderOrder: 0 } }
  );

  await CommercialFolder.findByIdAndDelete(folderId);

  res.json({ ok: true });
});

router.patch('/unassigned/units', async (req, res) => {
  const { unitIds, projectId } = req.body;

  if (!Array.isArray(unitIds) || !unitIds.length) {
    return res.status(400).json({ error: 'unitIds requerido' });
  }

  const filter = {
    _id: { $in: unitIds }
  };

  if (projectId) {
    filter.projectId = projectId;
  }

  if (req.tenantKey) {
    filter.tenantKey = req.tenantKey;
  }

  await Unit.updateMany(
    filter,
    {
      $set: {
        folderId: null,
        folderOrder: 0
      }
    }
  );

  res.json({ ok: true });
});

router.patch('/:id/units', async (req, res) => {
  const { unitIds } = req.body;
  const folderId = req.params.id;

  if (!Array.isArray(unitIds)) {
    return res.status(400).json({ error: 'unitIds debe ser array' });
  }

  await Promise.all(unitIds.map((unitId, index) =>
    Unit.findByIdAndUpdate(unitId, {
      folderId,
      folderOrder: index
    })
  ));

  res.json({ ok: true });
});

module.exports = router;