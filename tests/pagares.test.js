'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const Venta = require('../models/Venta');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('una venta admite varios pagarés con vencimiento y estado de cobro', () => {
  const venta = new Venta({
    projectId: new mongoose.Types.ObjectId(),
    unitId: new mongoose.Types.ObjectId(),
    tenantKey: 'tenant-test',
    pagares: [
      { numero: 'PG-001', monto: 12500, fechaVencimiento: '2027-01-15' },
      { numero: 'PG-002', monto: 8000, fechaVencimiento: '2027-02-15', cobrado: true, cobradoAt: '2027-02-01' }
    ]
  });

  assert.equal(venta.validateSync(), undefined);
  assert.equal(venta.pagares.length, 2);
  assert.equal(venta.pagares[0].numero, 'PG-001');
  assert.equal(venta.pagares[1].cobrado, true);
  assert.ok(venta.pagares.every(item => item._id));
});

test('la ficha y las alertas comparten el estado del pagaré', () => {
  const projectJs = read('public/js/project.js');
  const projectRoute = read('routes/projects.js');
  const ventaRoute = read('routes/ventas.js');
  const projectModel = read('models/Project.js');

  assert.match(projectJs, /function pagaresSectionHtml/);
  assert.match(projectJs, /function collectPagaresFromFicha/);
  assert.match(projectJs, /function getPagareExpiryAlerts/);
  assert.match(projectJs, /days > 30/);
  assert.match(projectJs, /kind: 'promissory_note'/);
  assert.match(projectRoute, /pagare\.cobrado = true/);
  assert.match(projectRoute, /pagare\.cobradoAt = pagare\.cobradoAt \|\| new Date\(\)/);
  assert.match(ventaRoute, /out\.pagares = sanitizePagares\(out\.pagares\)/);
  assert.match(projectModel, /'promissory_note'/);
});
