'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const { snapshotFromSale } = require('../services/fallenSales');

test('el desistimiento conserva una fotografia del cliente y la unidad', () => {
  const snapshot = snapshotFromSale({
    tenantKey: 'tenant-1',
    projectId: 'project-1',
    venta: {
      _id: 'sale-1', unitId: 'unit-1', primerNombre: 'Ana', primerApellido: 'Perez',
      cedula: '8-123-456', celular: '6000-0000', correo: 'ana@example.com',
      cliente2PrimerNombre: 'Luis', cliente2PrimerApellido: 'Perez',
      precioVenta: 125000, banco: 'Banco Uno'
    },
    unit: { _id: 'unit-1', manzana: 'A', lote: '12', modelo: 'Roble' },
    fechaCaida: new Date('2026-11-20T12:00:00Z'),
    motivoCaida: 'Decision del cliente'
  });

  assert.equal(snapshot.clienteNombre, 'Ana Perez');
  assert.equal(snapshot.cliente2Nombre, 'Luis Perez');
  assert.equal(snapshot.unidadLabel, 'A-12');
  assert.equal(snapshot.precioVenta, 125000);
  assert.equal(snapshot.origen, 'automatico');
});

test('Comercial ofrece listado y alta manual de ventas caidas', () => {
  const html = read('public/project.html');
  const js = read('public/js/project.js');
  const routes = read('routes/ventas.js');

  assert.match(html, /id="fallenSalesModal"/);
  assert.match(html, /id="fallenSalesForm"/);
  assert.match(html, /id="btnVentasCaidasComercial"/);
  assert.match(js, /api\/ventas\/fallen/);
  assert.match(routes, /router\.get\([\s\S]*?'\/fallen'/);
  assert.match(routes, /router\.post\([\s\S]*?'\/fallen'/);
  assert.match(routes, /router\.patch\([\s\S]*?'\/fallen\/:id'/);
  assert.match(routes, /router\.delete\([\s\S]*?'\/fallen\/:id'/);
  assert.match(routes, /recordAutomaticFallenSale/);
  assert.match(js, /fallen-sale-edit/);
  assert.match(js, /fallen-sale-delete/);
});

test('Resumen combina el historico permanente con las ventas caidas anteriores', () => {
  const projects = read('routes/projects.js');
  assert.match(projects, /FallenSale\.find\(\{ tenantKey, projectId: id \}\)/);
  assert.match(projects, /storedFallenSourceIds/);
  assert.match(projects, /filter\(entry => !entry\.deletedAt\)/);
  assert.match(projects, /fallenSalesYearMap\.set/);
});
