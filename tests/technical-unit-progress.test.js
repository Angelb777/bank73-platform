'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  HORIZONTAL_ACTIVITIES,
  VERTICAL_ACTIVITIES,
  templateForProjectType,
  activityAverage,
  normalizeUnitTechnicalProgress
} = require('../services/technicalUnitProgress');

test('usa exactamente las actividades horizontales de Flutter', () => {
  assert.equal(HORIZONTAL_ACTIVITIES.length, 17);
  assert.equal(HORIZONTAL_ACTIVITIES[0], 'Movimiento de tierra y cimentación');
  assert.equal(HORIZONTAL_ACTIVITIES[16], 'Terminaciones y limpieza');
  assert.ok(HORIZONTAL_ACTIVITIES.includes('Obras exteriores y conexiones'));
});

test('usa exactamente las actividades verticales de Flutter', () => {
  assert.equal(VERTICAL_ACTIVITIES.length, 15);
  assert.equal(VERTICAL_ACTIVITIES[0], 'Mampostería y divisiones');
  assert.equal(VERTICAL_ACTIVITIES[14], 'Terminaciones y limpieza');
  assert.ok(VERTICAL_ACTIVITIES.includes('Sistema contra incendios'));
});

test('elige la plantilla vertical para torres y apartamentos', () => {
  assert.equal(templateForProjectType('Residencial horizontal').kind, 'horizontal');
  assert.equal(templateForProjectType('Torre de apartamentos').kind, 'vertical');
  assert.equal(templateForProjectType('Proyecto vertical').kind, 'vertical');
});

test('calcula el promedio sólo con actividades aplicables', () => {
  assert.equal(activityAverage([
    { progressPercent: 20, applicable: true },
    { progressPercent: 80, applicable: true },
    { progressPercent: 100, applicable: false }
  ]), 50);
});

test('la primera configuración conserva el avance existente de la unidad', () => {
  const normalized = normalizeUnitTechnicalProgress({
    projectType: 'horizontal',
    initialProgress: 42
  });
  assert.equal(normalized.progressPercent, 42);
  assert.equal(normalized.activities.length, 17);
  assert.ok(normalized.activities.every(activity => activity.progressPercent === 42));
});
