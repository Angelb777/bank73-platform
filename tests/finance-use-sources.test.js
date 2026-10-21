const test = require('node:test');
const assert = require('node:assert/strict');

const ProjectFinance = require('../models/ProjectFinance');

function financeDocument(planUses, planSources = []) {
  return new ProjectFinance({
    tenantKey: 'test-tenant',
    project: '507f1f77bcf86cd799439011',
    phases: [{
      name: 'Fase 1',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
      planUses,
      planSources
    }]
  });
}

test('each planned use persists its own independent funding sources', () => {
  const document = financeDocument([
    {
      name: 'Infraestructura',
      amount: 500000,
      fundingSources: [
        { name: 'Banco', amount: 350000 },
        { name: 'Promotor', amount: 150000 }
      ]
    },
    {
      name: 'Comercializacion',
      amount: 100000,
      fundingSources: [
        { name: 'Banco', amount: 40000 },
        { name: 'Promotor', amount: 40000 },
        { name: 'Preventas', amount: 20000 }
      ]
    }
  ]);

  assert.equal(document.validateSync(), undefined);
  const uses = document.toObject().phases[0].planUses;
  assert.deepEqual(uses[0].fundingSources.map(({ name, amount }) => ({ name, amount })), [
    { name: 'Banco', amount: 350000 },
    { name: 'Promotor', amount: 150000 }
  ]);
  assert.deepEqual(uses[1].fundingSources.map(({ name, amount }) => ({ name, amount })), [
    { name: 'Banco', amount: 40000 },
    { name: 'Promotor', amount: 40000 },
    { name: 'Preventas', amount: 20000 }
  ]);
});

test('legacy planned uses remain distinguishable from uses with an explicit empty source list', () => {
  const document = financeDocument([
    { name: 'Uso anterior', amount: 100000 },
    { name: 'Uso nuevo sin fuentes', amount: 25000, fundingSources: [] }
  ]);

  const uses = document.toObject().phases[0].planUses;
  assert.equal(Object.hasOwn(uses[0], 'fundingSources'), false);
  assert.equal(Array.isArray(uses[1].fundingSources), true);
  assert.equal(uses[1].fundingSources.length, 0);
});
