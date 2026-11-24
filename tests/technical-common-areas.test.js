'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TECHNICAL_COMMON_AREA_TEMPLATES,
  normalizeTechnicalCommonAreas,
  overallCommonAreaProgress
} = require('../services/technicalCommonAreas');

test('las zonas comunes parten de cinco plantillas con actividades', () => {
  const areas = normalizeTechnicalCommonAreas([]);
  assert.equal(areas.length, 5);
  assert.deepEqual(areas.map(area => area.key), TECHNICAL_COMMON_AREA_TEMPLATES.map(area => area.key));
  assert.ok(areas.every(area => area.activities.length >= 5));
});

test('el avance de cada zona se calcula desde sus actividades aplicables', () => {
  const areas = normalizeTechnicalCommonAreas([{
    key: 'urbanizacion',
    observations: 'Seguimiento semanal',
    activities: [
      { key: 'movimiento_tierra', progressPercent: 100, applicable: true },
      { key: 'viales', progressPercent: 50, applicable: true },
      { key: 'aceras_bordillos', progressPercent: 100, applicable: false },
      { key: 'drenaje_vial', progressPercent: 0, applicable: true },
      { key: 'senalizacion', progressPercent: 0, applicable: true }
    ]
  }]);
  assert.equal(areas[0].progressPercent, 37.5);
  assert.equal(areas[0].observations, 'Seguimiento semanal');
  assert.equal(areas[0].activities[2].applicable, false);
});

test('el resumen general promedia las zonas activas', () => {
  const areas = normalizeTechnicalCommonAreas([]);
  areas[0].progressPercent = 50;
  areas[1].progressPercent = 100;
  assert.equal(overallCommonAreaProgress(areas), 30);
});
