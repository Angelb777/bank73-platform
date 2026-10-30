'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  customerPaymentRecipientTotals,
  customerPaymentSummary,
  effectiveCustomerPaymentAccounts
} = require('../services/customerPayments');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('la diferencia precio menos CPP es una obligación derivada, no un total duplicado', () => {
  const venta = { precioVenta: 120000, montoFinanciamientoCPP: 114000 };
  const accounts = effectiveCustomerPaymentAccounts(venta);
  assert.equal(accounts.length, 1);
  assert.equal(accounts[0].source, 'sale_gap');
  const summary = customerPaymentSummary(venta);
  assert.deepEqual(summary.totals, { agreed: 6000, paid: 0, balance: 6000, overpaid: 0 });
  assert.equal(summary.clearanceStatus, 'pending');
});

test('pagos, saldo y paz y salvo se calculan desde el mismo historial', () => {
  const venta = {
    precioVenta: 120000,
    montoFinanciamientoCPP: 114000,
    customerPaymentAccounts: [{
      source: 'sale_gap', concept: 'Abono del cliente', requiredForClearance: true,
      payments: [
        { paymentDate: '2026-01-01', receiptNumber: '1', amount: 1000 },
        { paymentDate: '2026-02-01', receiptNumber: '2', amount: 5000 }
      ]
    }]
  };
  const summary = customerPaymentSummary(venta);
  assert.equal(summary.totals.paid, 6000);
  assert.equal(summary.totals.balance, 0);
  assert.equal(summary.clearanceStatus, 'completed');
});

test('conceptos no requeridos no bloquean el paz y salvo', () => {
  const venta = {
    precioVenta: 100000,
    montoFinanciamientoCPP: 100000,
    customerPaymentAccounts: [{ source: 'manual', concept: 'Gasto opcional', agreedAmount: 500, requiredForClearance: false, payments: [] }]
  };
  const summary = customerPaymentSummary(venta);
  assert.equal(summary.totals.balance, 500);
  assert.equal(summary.clearanceStatus, 'not_applicable');
});

test('un recibo por encima de lo acordado queda identificado como sobrepago', () => {
  const summary = customerPaymentSummary({
    precioVenta: 120000,
    montoFinanciamientoCPP: 114000,
    customerPaymentAccounts: [{
      source: 'sale_gap', concept: 'Abono del cliente', requiredForClearance: true,
      payments: [{ paymentDate: '2026-01-01', receiptNumber: '1', amount: 6500 }]
    }]
  });
  assert.equal(summary.totals.overpaid, 500);
  assert.equal(summary.totals.balance, 0);
});

test('cada recibo se suma exclusivamente al beneficiario seleccionado', () => {
  const totals = customerPaymentRecipientTotals({
    precioVenta: 120000,
    montoFinanciamientoCPP: 114000,
    customerPaymentAccounts: [{
      source: 'sale_gap', concept: 'Abono del cliente', recipient: 'promoter',
      payments: [
        { paymentDate: '2026-10-30', receiptNumber: 'P-1', recipient: 'promoter', amount: 4000 },
        { paymentDate: '2026-10-30', receiptNumber: 'B-1', recipient: 'bank', amount: 2000 }
      ]
    }]
  });
  assert.deepEqual(totals, { bank: 2000, promoter: 4000, other: 0 });
});

test('Comercial, Finanzas, Legal y exportación consumen customerPaymentAccounts', () => {
  const project = read('public/js/project.js');
  const css = read('public/css/theme.css');
  const ventaModel = read('models/Venta.js');
  const finance = read('routes/finance.js');
  const projects = read('routes/projects.js');
  assert.match(project, /data-open-customer-payments/);
  assert.match(project, /function customerPaymentClientName/);
  assert.match(project, /Fecha del abono/);
  assert.match(project, /value="\$\{escapeHtml\(clientName\)\}" readonly/);
  assert.match(project, /data-payment-field="recipient"/);
  assert.doesNotMatch(project.slice(project.indexOf('function renderCustomerPaymentsModal'), project.indexOf('function readCustomerPaymentModal')), /Interés anual|Vencimiento|Observaciones|Añadir concepto/);
  assert.match(ventaModel, /CustomerPaymentSchema[\s\S]*?recipient:/);
  assert.match(project, /function renderFinancePhaseFundingSummary/);
  assert.match(project, /function financeCustomerPaymentRecipientTotals/);
  assert.match(project, /function scheduleCustomerPaymentsAutosave/);
  assert.match(project, /function persistCustomerPayments/);
  assert.match(project, /Abonos acordados/);
  assert.match(project, /finance-unit-section is-client/);
  assert.match(project, /finance-unit-section is-cpp/);
  assert.match(project, /finance-unit-section is-payments/);
  assert.match(project, /finance-unit-section is-allocation/);
  assert.match(project, /data-field="allocationPct"/);
  assert.match(css, /finance-unit-grid[\s\S]*?align-items: start/);
  assert.match(css, /finance-modal-funding-summary[\s\S]*?repeat\(8/);
  assert.match(css, /customer-payment-table-wrap select option \{ background:#0b1424; color:#f8fafc/);
  assert.match(finance, /Abonos clientes/);
  assert.match(projects, /customerPayments\.clearanceStatus/);
  assert.doesNotMatch(projects, /clearanceCount === 2/);
});
