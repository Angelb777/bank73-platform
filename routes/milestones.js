const express = require('express');
const Milestone = require('../models/Milestone');
const Project = require('../models/Project');
const { requireRoles } = require('../middleware/rbac');

const router = express.Router();

// GET /api/milestones?projectId=...
router.get('/', async (req, res) => {
  const q = { tenantKey: req.tenantKey };
  if (req.query.projectId) q.projectId = req.query.projectId;
  const list = await Milestone.find(q).sort({ createdAt: -1 }).lean();
  res.json(list);
});

// POST /api/milestones
router.post('/', requireRoles('admin', 'promoter'), async (req, res) => {
  const { projectId } = req.body || {};
  if (!projectId) return res.status(400).json({ error: 'projectId requerido' });

  const project = await Project.findOne({ _id: projectId, tenantKey: req.tenantKey }).select('_id').lean();
  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

  const data = { ...req.body, tenantKey: req.tenantKey };
  const m = await Milestone.create(data);
  res.status(201).json(m);
});

module.exports = router;
