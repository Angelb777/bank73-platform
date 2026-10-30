'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CAPTURE_CHANNELS,
  normalizeCaptureChannel,
  captureChannelForVenta
} = require('../services/captureChannel');

test('catálogo de captación conserva los nueve valores admitidos', () => {
  assert.deepEqual(CAPTURE_CHANNELS, [
    'Ferias',
    'Referido',
    'Valla publicitaria',
    'Broker',
    'Redes sociales',
    'Portales inmobiliarios',
    'En proyecto',
    'Oficina',
    'Mercadeo / volanteo'
  ]);
});

test('normaliza valores de Excel y conserva compatibilidad histórica', () => {
  for (const channel of CAPTURE_CHANNELS) {
    assert.equal(normalizeCaptureChannel(channel), channel);
  }
  assert.equal(normalizeCaptureChannel('ATENCIÓN EN OFICINA'), 'Oficina');
  assert.equal(normalizeCaptureChannel('mercadeo / prospecto'), 'Mercadeo / volanteo');
  assert.equal(normalizeCaptureChannel('Mail / Internet'), '');
  assert.equal(captureChannelForVenta({ captadoMailInternet: true }), 'Mail / Internet');
  assert.equal(captureChannelForVenta({ canalCaptacion: 'Broker', captadoMailInternet: true }), 'Broker');
});
