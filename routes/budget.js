const express = require('express');
const Budget = require('../models/Budget');

const router = express.Router();

// GET /api/budget/:projectId
router.get('/:projectId', async (req, res) => {
  const b = await Budget.findOne({ tenantKey: req.tenantKey, projectId: req.params.projectId }).lean();
  if (!b) return res.status(404).json({ error: 'Budget no encontrado' });
  res.json(b);
});

module.exports = router;
