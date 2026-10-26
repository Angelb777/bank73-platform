const test = require('node:test');
const assert = require('node:assert/strict');
const projectsRouter = require('../routes/projects');

const {
  sanitizeFinancePhases,
  deriveFinancialConditionsFromPhases,
  applyAutomaticPhaseSources,
  assertFinancePhasesBalanced
} = projectsRouter.__financePhaseHelpers;

function reconciledFinance({ financingLines = [] } = {}) {
  const phases = sanitizeFinancePhases([{
    name: 'Fase 1',
    planUses: [
      { name: 'Terreno', amount: 250000 },
      { name: 'Construccion', amount: 750000 }
    ],
    financialConditions: {
      phaseTotal: 42,
      bankFinancedPct: 70,
      promoterContributionPct: 30
    },
    financingLines
  }], 1);
  const conditions = deriveFinancialConditionsFromPhases({ projectTotal: 99 }, phases);
  return {
    conditions,
    phases: applyAutomaticPhaseSources(phases, conditions)
  };
}

test('project and phase totals are derived from phase uses', () => {
  const { conditions, phases } = reconciledFinance();

  assert.equal(phases[0].financialConditions.phaseTotal, 1000000);
  assert.equal(conditions.projectTotal, 1000000);
  assert.deepEqual(phases[0].planSources, [
    { name: 'Banco', amount: 700000 },
    { name: 'Promotor', amount: 300000 }
  ]);
  assert.doesNotThrow(() => assertFinancePhasesBalanced(phases, conditions));
});

test('optional or partially entered financing lines do not block project creation', () => {
  const empty = reconciledFinance();
  assert.doesNotThrow(() => assertFinancePhasesBalanced(empty.phases, empty.conditions));

  const partial = reconciledFinance({
    financingLines: [{ name: 'Terreno', approvedAmount: 250000 }]
  });
  assert.doesNotThrow(() => assertFinancePhasesBalanced(partial.phases, partial.conditions));
});

test('financing lines cannot exceed the bank source', () => {
  const { phases, conditions } = reconciledFinance({
    financingLines: [{ name: 'Construccion', approvedAmount: 700000.06 }]
  });

  assert.throws(
    () => assertFinancePhasesBalanced(phases, conditions),
    /no puede superar la fuente Banco/
  );
});
