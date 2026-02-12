const express = require('express');
const Milestone = require('../models/Milestone');
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
router.post('/', requireRoles('BANK_EXEC','PROMOTOR_PM'), async (req, res) => {
  const data = { ...req.body, tenantKey: req.tenantKey };
  const m = await Milestone.create(data);
  res.status(201).json(m);
});

module.exports = router;
