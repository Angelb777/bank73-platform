'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  UNIT_STATUSES,
  SOLD_UNIT_STATUSES,
  normalizeUnitStatus,
  isSoldUnitStatus
} = require('../utils/unitStatus');

test('el catálogo de estados de unidad tiene una sola definición canónica', () => {
  assert.deepEqual(UNIT_STATUSES, [
    'disponible',
    'inventario',
    'reservado',
    'con_cpp',
    'tramite_legal_activado',
    'escriturado_traspasado',
    'vivienda_entregada',
    'cancelado'
  ]);
  assert.ok(SOLD_UNIT_STATUSES.every(status => UNIT_STATUSES.includes(status)));
});

test('normaliza alias históricos sin inventar estados nuevos', () => {
  assert.equal(normalizeUnitStatus('Lote libre'), 'disponible');
  assert.equal(normalizeUnitStatus('Trámite legal'), 'tramite_legal_activado');
  assert.equal(normalizeUnitStatus('CON CPP'), 'con_cpp');
  assert.equal(normalizeUnitStatus('estado-desconocido'), 'disponible');
});

test('la clasificación de unidad vendida consume el mismo catálogo', () => {
  assert.equal(isSoldUnitStatus('reservado'), true);
  assert.equal(isSoldUnitStatus('vivienda_entregada'), true);
  assert.equal(isSoldUnitStatus('inventario'), false);
});
