const test = require('node:test');
const assert = require('node:assert/strict');

const projectsRouter = require('../routes/projects');
const { applyImportedHousingModels } = projectsRouter.__housingModelHelpers;

test('Dato Único completa el modelo desde sus unidades cuando la biblioteca solo tiene el nombre', () => {
  const project = {
    housingModels: [{ name: 'BARCELONA A1', bedrooms: 0, bathrooms: 0, openAreaM2: 0, closedAreaM2: 0 }]
  };
  const units = [
    { _id: 'u1', modelo: 'BARCELONA A1', recamaras: 3, banos: 3, areaAbierta: 26.1, areaCerrada: 110.61, costoUnidad: 90000, estado: 'disponible' },
    { _id: 'u2', modelo: 'BARCELONA A1', recamaras: 3, banos: 3, areaAbierta: 26.1, areaCerrada: 110.61, costoUnidad: 90000, estado: 'inventario' }
  ];

  applyImportedHousingModels(project, units);

  assert.equal(project.housingModels.length, 1);
  assert.deepEqual(
    {
      bedrooms: project.housingModels[0].bedrooms,
      bathrooms: project.housingModels[0].bathrooms,
      openAreaM2: project.housingModels[0].openAreaM2,
      closedAreaM2: project.housingModels[0].closedAreaM2,
      cost: project.housingModels[0].cost,
      unitsCount: project.housingModels[0].unitsCount
    },
    { bedrooms: 3, bathrooms: 3, openAreaM2: 26.1, closedAreaM2: 110.61, cost: 90000, unitsCount: 2 }
  );
});

test('Dato Único no inventa una característica común cuando las unidades del modelo discrepan', () => {
  const project = { housingModels: [{ name: 'MADRID' }] };
  const units = [
    { _id: 'u1', modelo: 'MADRID', recamaras: 2, estado: 'disponible' },
    { _id: 'u2', modelo: 'MADRID', recamaras: 3, estado: 'disponible' }
  ];

  applyImportedHousingModels(project, units);

  assert.ok(!(Number(project.housingModels[0].bedrooms) > 0));
});

test('Dato Único recupera como base del modelo el valor más frecuente de sus unidades', () => {
  const project = { housingModels: [{ name: 'BARCELONA A2' }] };
  const units = [
    { _id: 'u1', modelo: 'BARCELONA A2', areaAbierta: 29.4, areaCerrada: 110.65, estado: 'disponible' },
    { _id: 'u2', modelo: 'BARCELONA A2', areaAbierta: 29.4, areaCerrada: 110.65, estado: 'disponible' },
    { _id: 'u3', modelo: 'BARCELONA A2', areaAbierta: 26.1, areaCerrada: 110.61, estado: 'disponible' }
  ];

  applyImportedHousingModels(project, units);

  assert.equal(project.housingModels[0].openAreaM2, 29.4);
  assert.equal(project.housingModels[0].closedAreaM2, 110.65);
});

test('el valor ya definido en el modelo prevalece sobre copias antiguas de las unidades', () => {
  const project = { housingModels: [{ name: 'MADRID', bedrooms: 4 }] };
  const units = [
    { _id: 'u1', modelo: 'MADRID', recamaras: 2, estado: 'disponible' },
    { _id: 'u2', modelo: 'MADRID', recamaras: 2, estado: 'disponible' }
  ];

  applyImportedHousingModels(project, units);

  assert.equal(project.housingModels[0].bedrooms, 4);
});
