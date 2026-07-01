const express = require('express');
const Loan = require('../models/Loan');
const Project = require('../models/Project');
const { requireRoles } = require('../middleware/rbac');

const router = express.Router();

async function loadTenantProject(req, res) {
  const project = await Project.findOne({
    _id: req.params.projectId,
    tenantKey: req.tenantKey
  });

  if (!project) {
    res.status(404).json({ error: 'Proyecto no encontrado' });
    return null;
  }

  return project;
}

// GET /api/loans/:projectId
router.get('/:projectId', async (req, res) => {
  const project = await loadTenantProject(req, res);
  if (!project) return;

  const loan = await Loan.findOne({
    tenantKey: req.tenantKey,
    projectId: req.params.projectId
  }).lean();

  if (!loan) return res.status(404).json({ error: 'Loan no encontrado' });
  res.json(loan);
});

// POST /api/loans/:projectId/disburse  { amount }
router.post('/:projectId/disburse', requireRoles('admin'), async (req, res) => {
  const amount = Number(req.body?.amount || 0);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Monto invalido' });

  const project = await loadTenantProject(req, res);
  if (!project) return;

  const loan = await Loan.findOne({
    tenantKey: req.tenantKey,
    projectId: req.params.projectId
  });

  if (!loan) return res.status(404).json({ error: 'Loan no encontrado' });

  loan.disbursements.push({ date: new Date(), amount });
  await loan.save();

  project.loanDisbursed += amount;
  project.loanBalance = Math.max(0, (project.loanApproved || 0) - (project.loanDisbursed || 0));
  await project.save();

  res.json({ ok: true, loan });
});

module.exports = router;
