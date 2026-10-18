import test from 'node:test';
import assert from 'node:assert/strict';
import { elPalmarProject } from '../src/data/el-palmar.project.js';
import { buildProject } from '../src/model/project-builder.js';
import { buildInteriorForUnit } from '../src/model/interior-builder.js';

test('creates independent, selectable units with the current Tower C inventory', () => {
  const built = buildProject(elPalmarProject);
  const expectedCount = elPalmarProject.towers.reduce(
    (total, tower) => total + tower.floors.reduce((sum, floor) => sum + floor.units.length, 0),
    0
  );
  assert.equal(expectedCount, 249);
  assert.equal(built.towers.size, 3);
  assert.equal(built.units.size, expectedCount);
  assert.equal(new Set(built.units.keys()).size, expectedCount);

  built.units.forEach((unit, unitId) => {
    assert.equal(unit.userData.unitId, unitId);
    assert.equal(unit.userData.kind, 'unit');
    assert.ok(unit.userData.selectableMesh);
    assert.equal(unit.userData.selectableMesh.userData.unitRoot, unit);
    assert.equal(unit.userData.isDemo, false);
  });

  const counts = { A: 0, B: 0, C: 0 };
  const types = { A: {}, B: {}, C: {} };
  built.units.forEach((unit) => {
    const { towerId, apartmentModel } = unit.userData;
    counts[towerId] += 1;
    types[towerId][apartmentModel] = (types[towerId][apartmentModel] || 0) + 1;
  });
  assert.deepEqual(counts, { A: 96, B: 96, C: 57 });
  assert.deepEqual(types.A, { '2 recámaras': 44, '1 recámara': 44, '3 recámaras': 6, PH: 2 });
  assert.deepEqual(types.B, types.A);
  assert.deepEqual(types.C, { 'Modelo A': 9, 'Modelo B': 10, 'Modelo C': 16, 'Modelo C1': 18, 'Modelo D': 4 });

  const towerCUnits = [...built.units.values()].filter((item) => item.userData.towerId === 'C');
  const floorCounts = towerCUnits.reduce((countsByFloor, item) => {
    const key = String(item.userData.floor).padStart(3, '0');
    countsByFloor[key] = (countsByFloor[key] || 0) + 1;
    return countsByFloor;
  }, {});
  assert.deepEqual(floorCounts, { '-400': 11, '-300': 12, '-200': 12, '-100': 11, '000': 11 });
  assert.equal(new Set(towerCUnits.map((item) => item.userData.externalId)).size, 57);
  assert.equal(built.units.get('L-306').userData.commercial.status, 'sold');
  assert.equal(built.units.get('L-207').userData.commercial.status, 'available');
  assert.equal(built.units.get('L-501').userData.sourceKind, 'official-single-source');
  assert.equal(built.units.get('L-501').userData.interiorAvailable, false);
});

test('builds a roofless interior while preserving the selected unitId', () => {
  const models = ['1 recámara', '2 recámaras', '3 recámaras', 'PH'];
  models.forEach((apartmentModel, index) => {
    const unitId = `TEST-${index + 1}`;
    const interior = buildInteriorForUnit({ unitId, apartmentModel });
    assert.equal(interior.userData.unitId, unitId);
    assert.equal(interior.userData.kind, 'interior');
    assert.equal(interior.userData.approximation, true);
    assert.ok(interior.userData.width > 0);
    assert.ok(interior.userData.depth > 0);
    assert.ok(interior.children.length > 5);
  });
});
