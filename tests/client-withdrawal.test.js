'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('el desistimiento exige confirmación y se ofrece solo desde la ficha comercial', () => {
  const html = read('public/project.html');
  const js = read('public/js/project.js');

  assert.match(html, /id="fichaDesistirCliente"[^>]*>Desistir cliente</);
  assert.match(js, /confirm\('¿Estás seguro de que quieres borrar todos los datos del cliente\?'\)/);
  assert.match(js, /fichaMode !== 'commercial'/);
  assert.match(js, /\/api\/ventas\/by-unit\/\$\{encodeURIComponent\(fichaUnitId\)\}\/desist-client/);
});

test('el servidor limpia el expediente y conserva unidad y construcción', () => {
  const route = read('routes/ventas.js');

  assert.match(route, /DESIST_PRESERVED_FIELDS/);
  for (const field of [
    'numeroFinca', 'codigoUbicacion', 'areaAbierta', 'areaCerrada',
    'avanceConstruccionPct', 'permisoConstruccionMunicipal',
    'permisoOcupacion', 'constructora'
  ]) {
    assert.match(route, new RegExp(`'${field}'`));
  }
  assert.match(route, /customerPaymentAccounts: \[\]/);
  assert.match(route, /pagares: \[\]/);
  assert.match(route, /estadoVenta: 'caida'/);
  assert.match(route, /category: \/\^commercialSaleField:\//);
  assert.match(route, /category: archiveCategory/);
  assert.match(route, /audit\(req, 'sale\.client_withdrawn'/);
});
