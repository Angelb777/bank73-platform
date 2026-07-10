const express = require('express');
const Budget = require('../models/Budget');
const Project = require('../models/Project');
const { requireProjectAccess } = require('../middleware/rbac');

const router = express.Router();

// GET /api/budget/:projectId
router.get('/:projectId', requireProjectAccess(), async (req, res) => {
  const project = await Project.findOne({ _id: req.params.projectId, tenantKey: req.tenantKey }).select('_id').lean();
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

  const b = await Budget.findOne({ tenantKey: req.tenantKey, projectId: req.params.projectId }).lean();
  if (!b) return res.status(404).json({ error: 'Budget no encontrado' });
  res.json(b);
});

module.exports = router;
