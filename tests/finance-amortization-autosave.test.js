'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const projectJs = fs.readFileSync(path.join(root, 'public/js/project.js'), 'utf8');
const projectHtml = fs.readFileSync(path.join(root, 'public/project.html'), 'utf8');

test('las amortizaciones por unidad se autoguardan después de persistir las líneas', () => {
  const flushStart = projectJs.indexOf('async function flushFinanceUnitAutosave');
  const flushEnd = projectJs.indexOf('async function saveFinanceSingleUnit', flushStart);
  const flushSource = projectJs.slice(flushStart, flushEnd);

  assert.ok(flushStart >= 0 && flushEnd > flushStart);
  assert.ok(
    flushSource.indexOf('await flushFinanceLoanLinesAutosave') <
      flushSource.indexOf('saveFinanceUnitAmortizations'),
    'las líneas deben obtener ids definitivos antes de guardar sus amortizaciones'
  );
  assert.match(projectJs, /scheduleFinanceUnitAutosave[\s\S]*?flushFinanceUnitAutosave\(\{ showAlert: false \}\)/);
  assert.match(projectJs, /financeUnitAmortizations'\)\?\.addEventListener\('focusout'/);
  assert.match(projectHtml, /id="financeUnitSaveStatus"[^>]*>Autoguardado: guardado</);
});

test('la tabla de movimientos unifica visualmente los importes sin alterar sus campos financieros', () => {
  const renderStart = projectJs.indexOf('function renderFinanceLoanLines');
  const renderEnd = projectJs.indexOf('function mergedFinanceUnitAmortizations', renderStart);
  const renderSource = projectJs.slice(renderStart, renderEnd);

  assert.match(renderSource, /<th>Importe<\/th>/);
  assert.doesNotMatch(renderSource, /<th>Importe banco<\/th>|<th>Amortización \/ interés<\/th>|<th>Saldo<\/th>/);
  assert.doesNotMatch(renderSource, /class="finance-balance"/);
  assert.match(renderSource, /'disbursementAmount'[\s\S]*?'interestAmount'[\s\S]*?'amortizedAmount'/);
  assert.match(renderSource, /preservedLegacyAmounts/);
  for (const kpi of ['Aprobado', 'Desembolsado', 'Total amort.', 'Intereses pagados', 'Saldo por pagar']) {
    assert.match(renderSource, new RegExp(kpi.replace('.', '\\.')));
  }
});

