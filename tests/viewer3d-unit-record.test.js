'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  COMMERCIAL_STATUS_BY_UNIT_STATUS,
  buildViewer3DUnitRecord
} = require('../services/viewer3d_unit_record');

test('the viewer exposes exactly the six approved statuses from Commercial', () => {
  assert.deepEqual(Object.keys(COMMERCIAL_STATUS_BY_UNIT_STATUS), [
    'disponible', 'inventario', 'reservado', 'con_cpp',
    'tramite_legal_activado', 'escriturado_traspasado'
  ]);
});

test('legacy delivered units remain compatible as transferred without exposing a seventh status', () => {
  const record = buildViewer3DUnitRecord({ unit: { estado: 'vivienda_entregada' } });
  assert.equal(record.commercial.status, 'transferred');
});

test('maps every visible 3D value from the Commercial unit record', () => {
  const record = buildViewer3DUnitRecord({
    unit: {
      _id: 'unit-1', manzana: '-100', lote: 'L-408', modelo: 'D',
      recamaras: 3, banos: 2, areaAbierta: 10, areaCerrada: 99.27,
      areaTotalConstruccion: 109.27, costoUnidad: 145000,
      estado: 'escriturado_traspasado',
      viewer3D: {
        geometryKey: 'L-408', tower: 'C', progressStatus: 'pending',
        constructionPhase: 'DATO ILUSTRATIVO', budgetCost: 999999, actualCost: 999999
      }
    },
    venta: {
      precioVenta: 245000, montoFinanciamientoCPP: 215000,
      customerPaymentAccounts: [{
        source: 'sale_gap', concept: 'Abono del cliente',
        payments: [{ paymentDate: '2026-01-10', amount: 30000 }]
      }],
      estatusConstruccion: 'Acabados', faseConstruccion: 'Pintura'
    },
    project: { currency: 'PAB', viewer3D: { primaryTower: 'C' } }
  });

  assert.equal(record.commercial.status, 'transferred');
  assert.equal(record.commercial.askingPrice, 245000);
  assert.equal(record.commercial.salePrice, 245000);
  assert.equal(record.progress.status, 'finishing');
  assert.equal(record.progress.phase, 'Pintura');
  assert.equal(record.finance.budgetCost, 145000);
  assert.equal(record.finance.collected, 30000);
  assert.equal(record.finance.estimatedMargin, 100000);
  assert.equal(record.closedArea, 99.27);
  assert.equal(record.totalArea, 109.27);
});

test('does not invent missing values or use legacy viewer business data', () => {
  const record = buildViewer3DUnitRecord({
    unit: {
      _id: 'unit-2', lote: 'L-409', estado: 'cancelado',
      viewer3D: { budgetCost: 999999, actualCost: 888888, progressPct: 73 }
    },
    venta: {},
    project: { viewer3D: { primaryTower: 'C' } }
  });

  assert.equal(record.commercial.status, 'unknown');
  assert.equal(record.commercial.askingPrice, null);
  assert.equal(record.finance.budgetCost, null);
  assert.equal(record.finance.salePrice, null);
  assert.equal(record.progress.status, 'unknown');
  assert.equal(record.progress.percentage, null);
  assert.equal(record.closedArea, null);
  assert.equal(record.totalArea, null);
});
