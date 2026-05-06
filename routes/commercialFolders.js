const express = require('express');
const router = express.Router();
const CommercialFolder = require('../models/CommercialFolder');
const Unit = require('../models/Unit');

router.get('/', async (req, res) => {
  const { projectId } = req.query;
  const folders = await CommercialFolder.find({ projectId }).sort({ order: 1, createdAt: 1 });
  res.json(folders);
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