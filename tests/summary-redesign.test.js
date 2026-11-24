'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('la cabecera del resumen presenta portada, logo y tres bandas de negocio', () => {
  const html = read('public/project.html');
  const js = read('public/js/project.js');
  assert.match(html, /id="summaryProjectLogoBtn"/);
  assert.match(html, /id="summaryProjectCoverBtn"/);
  assert.match(js, /Estimación total de ventas/);
  assert.match(js, /Estimación total de costes/);
  assert.match(js, /Monto de financiamiento aprobado/);
  assert.match(js, /band\('sales', 'Ventas'/);
  assert.doesNotMatch(html, /id="summaryProgressText"/);
});

test('el resumen comercial usa solo los estados activos y ventas por fecha de reserva', () => {
  const projects = read('routes/projects.js');
  const html = read('public/project.html');
  assert.match(projects, /status: 'Lote libre'/);
  assert.match(projects, /status: 'Traspasado', count: U\.escrituradas \+ U\.entregadas/);
  assert.doesNotMatch(projects.match(/const unitsByStatus = \[[\s\S]*?\];/)?.[0] || '', /Cancelada|Vivienda entregada/);
  assert.match(projects, /const d = v\?\.fechaReserva \? new Date\(v\.fechaReserva\)/);
  assert.doesNotMatch(html, /id="sumSalesMonthlySummary"/);
});

test('legal y técnico eliminan gráficas redundantes', () => {
  const html = read('public/project.html');
  assert.match(html, /id="sumLegalMinutes"/);
  assert.match(html, /id="sumLegalProgressByStage"/);
  assert.doesNotMatch(html, /id="sumLegalLiberacion"|id="sumLegalSegregacion"|id="sumLegalPrestamo"|id="sumProtocolByBank"/);
  assert.doesNotMatch(html, /id="sumConstructionStatus"/);
  assert.match(html, /id="sumConstructionPhase"/);
  assert.match(html, /<h3>Estatus construcci/);
  assert.match(html, /<h3>Duraci/);
  assert.doesNotMatch(html, /sumPhaseTimeDelayChart|DesviaciÃ³n temporal - Fecha final/);
});

test('el resumen replica la retÃ­cula compacta y elimina paneles duplicados', () => {
  const html = read('public/project.html');
  const css = read('public/css/theme.css');
  const js = read('public/js/project.js');
  assert.match(html, /summary-dashboard-grid summary-commercial-dashboard/);
  assert.match(html, /summary-span-4 chart-card-sm[\s\S]*?sumUnitsDonut/);
  assert.match(html, /summary-span-8 summary-sales-monthly-card/);
  assert.match(html, /summary-span-12 summary-cpp-bank-card/);
  assert.doesNotMatch(html, /id="sumSalesVsFallen"/);
  assert.doesNotMatch(html, /summaryFinancialProfile|summaryFinanceControlCards|summaryTechnicalKpis|summaryCustomerReportKpis/);
  assert.match(css, /grid-template-columns:\s*repeat\(12, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.summary-dashboard-grid \.summary-chart-card \{[\s\S]*?height:\s*100%[\s\S]*?display:\s*flex/);
  assert.match(css, /\.summary-sales-monthly-card \.summary-chart-box \{\s*height:\s*auto;\s*min-height:\s*270px/);
  assert.match(css, /\.summary-permits-card \.summary-chart-box \{\s*height:\s*auto;\s*min-height:\s*315px/);
  assert.match(css, /\.summary-legal-stage-card \.summary-chart-box \{\s*height:\s*auto;\s*min-height:\s*300px/);
  assert.match(css, /\.summary-chart-card\.chart-phase-lg \.summary-chart-box \{[\s\S]*?flex:\s*1 1 auto;[\s\S]*?height:\s*auto/);
  assert.match(css, /#summaryFinancialKpis\.kpis-grid,[\s\S]*?#summaryLegalKpis\.kpis-grid[\s\S]*?justify-content:\s*center/);
  assert.match(js, /while \(year < endYear \|\| \(year === endYear && month <= endMonth\)\)/);
});

test('CPP vigente excluye unidades traspasadas y la cobertura usa ese monto', () => {
  const projects = read('routes/projects.js');
  const js = read('public/js/project.js');
  assert.match(projects, /\['reservado', 'con_cpp', 'tramite_legal_activado'\]\.includes\(v\.__unitStatus\)/);
  assert.match(js, /const coverageReceivable = toNum\(fc\.cppVigenteAmount\)/);
  assert.doesNotMatch(js.match(/renderTargetKpis\('summaryFinancialKpis'[\s\S]*?\]\);/)?.[0] || '', /Valor base \/ cheques|Total promotor/);
});
