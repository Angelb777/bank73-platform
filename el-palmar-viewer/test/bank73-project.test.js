import test from 'node:test';
import assert from 'node:assert/strict';
import { loadBank73Project, withoutBank73UnitData } from '../src/data/bank73-project.js';

function baseProject() {
  return {
    id: 'base',
    name: 'Base',
    towers: [
      { id: 'A', name: 'Torre A', floors: [] },
      { id: 'B', name: 'Torre B', floors: [] },
      {
        id: 'C', name: 'Torre C',
        floors: [{
          level: -100,
          units: [
            { unitId: 'L-408', externalId: 'L-408', commercialStatus: 'transferred', price: 250000 },
            { unitId: 'L-409', externalId: 'L-409', commercialStatus: 'transferred', price: 205000 }
          ]
        }]
      }
    ]
  };
}

test('links geometry by stable geometryKey and renders only unit-record data', async () => {
  globalThis.localStorage = { getItem: () => null };
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      enabled: true,
      project: { id: 'project-1', name: 'THE PALMS', towers: [] },
      units: [{
        id: 'mongo-unit-1', geometryKey: 'L-408', unitId: 'Unidad D-408', model: 'D',
        bedrooms: 3, bathrooms: 2, closedArea: 109.27, openArea: 0, totalArea: 109.27,
        commercial: { status: 'transferred', askingPrice: 250000, listPrice: 250000, salePrice: 245000, currency: 'PAB' },
        progress: { status: 'completed', percentage: null, phase: 'Entrega', label: 'Culminada' },
        finance: { status: 'onTrack', budgetCost: 145000, salePrice: 250000, estimatedMargin: 105000 },
        sourceLabel: 'Ficha única de la unidad · Bank73'
      }]
    })
  });

  const result = await loadBank73Project(baseProject(), 'project-1');
  const [linked, unlinked] = result.towers.find(tower => tower.id === 'C').floors[0].units;
  assert.equal(linked.unitId, 'Unidad D-408');
  assert.equal(linked.bank73UnitId, 'mongo-unit-1');
  assert.equal(linked.price, 250000);
  assert.equal(linked.salePrice, 245000);
  assert.equal(linked.finance.budgetCost, 145000);
  assert.equal(unlinked.bank73UnitId, '');
  assert.equal(unlinked.commercialStatus, 'unknown');
  assert.equal(unlinked.price, null);
});

test('clears embedded spreadsheet values when Bank73 data is unavailable', () => {
  const result = withoutBank73UnitData(baseProject());
  const units = result.towers.find(tower => tower.id === 'C').floors[0].units;
  assert.deepEqual(units.map(unit => unit.commercialStatus), ['unknown', 'unknown']);
  assert.deepEqual(units.map(unit => unit.price), [null, null]);
});
