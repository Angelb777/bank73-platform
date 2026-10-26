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
  const { conditions, phases } = reconciledFinance({
    financingLines: [{ name: 'Financiacion bancaria', approvedAmount: 700000 }]
  });

  assert.equal(phases[0].financialConditions.phaseTotal, 1000000);
  assert.equal(conditions.projectTotal, 1000000);
  assert.deepEqual(phases[0].planSources, [
    { name: 'Banco', amount: 700000 },
    { name: 'Promotor', amount: 300000 }
  ]);
  assert.doesNotThrow(() => assertFinancePhasesBalanced(phases, conditions));
});

test('empty or partial financing lines block creation when there is a bank source', () => {
  const empty = reconciledFinance();
  assert.throws(
    () => assertFinancePhasesBalanced(empty.phases, empty.conditions),
    /debe coincidir con la fuente Banco/
  );

  const partial = reconciledFinance({
    financingLines: [{ name: 'Terreno', approvedAmount: 250000 }]
  });
  assert.throws(
    () => assertFinancePhasesBalanced(partial.phases, partial.conditions),
    /debe coincidir con la fuente Banco/
  );
});

test('financing lines cannot exceed the bank source either', () => {
  const { phases, conditions } = reconciledFinance({
    financingLines: [{ name: 'Construccion', approvedAmount: 700000.06 }]
  });

  assert.throws(
    () => assertFinancePhasesBalanced(phases, conditions),
    /debe coincidir con la fuente Banco/
  );
});

test('100 percent bank financing clears stale promoter values on the server', () => {
  const phases = sanitizeFinancePhases([{
    name: 'Fase 100% banco',
    planUses: [{ name: 'Construccion', amount: 1000000 }],
    financialConditions: {
      bankFinancedAmount: 1000000,
      bankFinancedPct: 100,
      // Simula valores auxiliares antiguos que no deben alterar las fuentes visibles.
      promoterContribution: 300000,
      promoterContributionPct: 30
    },
    financingLines: [{ name: 'Construccion', approvedAmount: 1000000 }]
  }], 1);
  const conditions = deriveFinancialConditionsFromPhases({}, phases);
  const reconciled = applyAutomaticPhaseSources(phases, conditions);

  assert.deepEqual(reconciled[0].planSources, [
    { name: 'Banco', amount: 1000000 },
    { name: 'Promotor', amount: 0 }
  ]);
  assert.equal(reconciled[0].financialConditions.promoterContribution, 0);
  assert.equal(reconciled[0].financialConditions.promoterContributionPct, 0);
  assert.doesNotThrow(() => assertFinancePhasesBalanced(reconciled, conditions));
});
