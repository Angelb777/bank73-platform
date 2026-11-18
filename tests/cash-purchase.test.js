'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { deriveCommercialState } = require('../services/unitCommercialState');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('la compra al contado ignora hitos bancarios al calcular el estado', () => {
  const result = deriveCommercialState({
    modalidadFinanciamiento: 'Al contado',
    fechaReserva: '2026-11-10',
    fechaValorCPP: '2026-11-11',
    estatusCPP: 'CPP recibida',
    solicitudAvaluo: '2026-11-12'
  });
  assert.equal(result.estado, 'reservado');
});

test('la ficha bloquea exactamente los campos no aplicables al contado', () => {
  const js = read('public/js/project.js');
  const source = js.slice(
    js.indexOf('const COMMERCIAL_CASH_DISABLED_FIELD_IDS'),
    js.indexOf('function isCashPurchaseMode')
  );
  const expected = [
    'fv-montoFinanciamientoCPP', 'fv-banco',
    'fv-fechaProforma', 'fv-fechaProbableEntrega', 'fv-estatusCPP',
    'fv-numCPP', 'fv-fechaValorCPP', 'fv-fechaVencimientoCPP', 'fv-aperturaCtaBanco',
    'fv-polizaVidaEntregada', 'fv-tipoPolizaVida', 'fv-polizaIncendioEntregada', 'fv-tipoPolizaIncendio',
    'fv-mLiberacion', 'fv-mSegregacion',
    'fv-solicitudAvaluo', 'fv-fechaAvaluo', 'fv-empresaAvaluadora',
    'fv-mPrestamo', 'fv-fechaProtocoloFirmaBancoCliente'
  ];
  expected.forEach(fieldId => assert.match(source, new RegExp(`'${fieldId}'`)));
  assert.equal((source.match(/'fv-/g) || []).length, expected.length);
  assert.match(js, /No aplica · compra al contado/);
  assert.match(js, /control\.disabled = cashPurchase/);
  assert.match(js, /venta\?\.modalidadFinanciamiento[^\n]+Al contado/);
});
