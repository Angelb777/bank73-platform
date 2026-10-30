'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  buildProjectCollectionCoverage,
  unitCollectionBalance
} = require('../services/projectCollectionCoverage');

test('el saldo por cobrar descuenta abonos y la CPP solo cuando fue desembolsada', () => {
  const base = {
    precioVenta: 150000,
    montoFinanciamientoCPP: 120000,
    customerPaymentAccounts: [{
      source: 'sale_gap', concept: 'Abono del cliente', requiredForClearance: true,
      payments: [{ paymentDate: '2026-01-10', receiptNumber: 'R-1', amount: 10000 }]
    }]
  };
  assert.deepEqual(unitCollectionBalance(base), {
    salePrice: 150000, customerPaid: 10000, bankReceived: 0, collected: 10000, balance: 140000
  });
  assert.equal(unitCollectionBalance({ ...base, fechaDesembolso: '2026-05-01' }).balance, 20000);
});

test('la cobertura incluye toda unidad con saldo y excluye las totalmente cobradas', () => {
  const units = [
    { _id: 'free', estado: 'disponible' },
    { _id: 'reserved', estado: 'reservado' },
    { _id: 'legal', estado: 'escriturado_traspasado' },
    { _id: 'paid', estado: 'escriturado_traspasado' }
  ];
  const salesByUnit = new Map([
    ['free', { precioVenta: 100000 }],
    ['reserved', { precioVenta: 120000, montoFinanciamientoCPP: 90000 }],
    ['legal', { precioVenta: 150000, montoFinanciamientoCPP: 120000 }],
    ['paid', {
      precioVenta: 150000, montoFinanciamientoCPP: 120000, fechaDesembolso: '2026-05-01',
      customerPaymentAccounts: [{
        source: 'sale_gap', concept: 'Abono del cliente', requiredForClearance: true,
        payments: [{ paymentDate: '2026-01-10', receiptNumber: 'R-2', amount: 30000 }]
      }]
    }]
  ]);
  const result = buildProjectCollectionCoverage({
    units, salesByUnit, totalDebt: 300000, getStatus: unit => unit.estado
  });
  assert.equal(result.buckets.available.amount, 100000);
  assert.equal(result.buckets.reserved.amount, 120000);
  assert.equal(result.buckets.pipeline.amount, 150000);
  assert.equal(result.totalReceivable, 370000);
  assert.equal(result.difference, 70000);
  assert.equal(result.canCoverDebt, true);
  assert.equal(result.fullyCollectedUnits, 1);
});

test('el Resumen responde expresamente si los cobros pendientes cubren la deuda', () => {
  const root = path.resolve(__dirname, '..');
  const html = fs.readFileSync(path.join(root, 'public/project.html'), 'utf8');
  const frontend = fs.readFileSync(path.join(root, 'public/js/project.js'), 'utf8');
  const projects = fs.readFileSync(path.join(root, 'routes/projects.js'), 'utf8');

  assert.match(html, /¿Lo pendiente de cobro cubre la deuda actual\?/);
  assert.match(frontend, /collectionCoverage\.canCoverDebt/);
  assert.match(frontend, /Saldo pendiente de cobro/);
  assert.match(projects, /buildProjectCollectionCoverage/);
  assert.match(projects, /Cobertura de deuda con cobros pendientes/);
  assert.doesNotMatch(frontend, /'CPP vigentes', amount|'CPP en trámite', amount/);
});
