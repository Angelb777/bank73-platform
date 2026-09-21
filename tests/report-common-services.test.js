'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPeriodActivity } = require('../services/reportActivity');
const { financeApprovedTotals, buildFinanceControlSummary } = require('../services/financeReportContext');

test('shared Summary period activity preserves document, permit and disbursement calculations', () => {
  const period = {
    from: '2026-09-01', to: '2026-09-30', label: 'septiembre',
    start: new Date('2026-09-01T00:00:00Z'), end: new Date('2026-09-30T23:59:59Z')
  };
  const activity = buildPeriodActivity({
    period,
    documents: [
      { createdAt: '2026-09-02T12:00:00Z', mimetype: 'application/pdf', originalname: 'plano.pdf' },
      { createdAt: '2026-09-03T12:00:00Z', mimetype: 'image/jpeg', originalname: 'obra.jpg' }
    ],
    permits: [{ title: 'Construccion', status: 'approved', resolvedAt: '2026-09-04T12:00:00Z' }],
    financePhases: [{ name: 'Fase 1', disbActual: 250000, disbActualAt: '2026-09-05T12:00:00Z' }]
  });
  assert.equal(activity.totals.documents, 2);
  assert.equal(activity.totals.photos, 1);
  assert.equal(activity.totals.permitsApproved, 1);
  assert.equal(activity.totals.disbursementsReceived, 1);
  assert.equal(activity.totals.disbursedAmount, 250000);
});

test('shared Finance context preserves approved, disbursed and amortized totals', () => {
  const finance = {
    phases: [{
      financialConditions: { phaseTotal: 1000000, bankFinancedAmount: 700000, promoterContribution: 300000 },
      planUses: [{ name: 'Obra', amount: 1000000 }],
      uses: [{ name: 'Obra', amount: 400000 }]
    }],
    loanLines: [{
      _id: 'line-1', name: 'Linea 1',
      entries: [{ disbursementAmount: 350000, amortizedAmount: 50000, maturityDate: '2099-01-01' }]
    }],
    unitAmortizations: [{
      unitId: 'unit-1', checkAmount: 25000,
      allocations: [{ loanLineId: 'line-1', amount: 20000 }], promoterAmount: 5000
    }]
  };
  assert.deepEqual(financeApprovedTotals(finance, {}), {
    budgetApproved: 1000000,
    loanApproved: 700000,
    promoterContribution: 300000
  });
  const control = buildFinanceControlSummary(finance, {});
  assert.equal(control.totals.totalDisbursed, 350000);
  assert.equal(control.totals.totalManualAmortized, 50000);
  assert.equal(control.totals.totalAllocatedAmortized, 20000);
  assert.equal(control.totals.currentDebtBalance, 280000);
  assert.equal(control.totals.planVsRealDifference, -600000);
});
