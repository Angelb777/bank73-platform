const express = require('express');
const Loan = require('../models/Loan');
const Project = require('../models/Project');
const { requireRoles } = require('../middleware/rbac');

const router = express.Router();

// GET /api/loans/:projectId
router.get('/:projectId', async (req, res) => {
  const loan = await Loan.findOne({ tenantKey: req.tenantKey, projectId: req.params.projectId }).lean();
  if (!loan) return res.status(404).json({ error: 'Loan no encontrado' });
  res.json(loan);
});

// POST /api/loans/:projectId/disburse  { amount }
router.post('/:projectId/disburse', requireRoles('BANK_EXEC'), async (req, res) => {
  const amount = Number(req.body?.amount || 0);
  if (!amount || amount <= 0) return res.status(400).json({ error: 'Monto inválido' });

  const loan = await Loan.findOne({ tenantKey: req.tenantKey, projectId: req.params.projectId });
  if (!loan) return res.status(404).json({ error: 'Loan no encontrado' });

  loan.disbursements.push({ date: new Date(), amount });
  await loan.save();

  // Actualizar KPIs del proyecto
  const project = await Project.findOne({ _id: req.params.projectId, tenantKey: req.tenantKey });
  if (project) {
    project.loanDisbursed += amount;
    project.loanBalance = Math.max(0, (project.loanApproved || 0) - (project.loanDisbursed || 0));
    await project.save();
  }

  res.json({ ok: true, loan });
});

module.exports = router;
