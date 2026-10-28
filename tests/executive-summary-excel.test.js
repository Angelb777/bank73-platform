'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ExcelJS = require('exceljs');
const PizZip = require('pizzip');
const { buildExecutiveSummaryWorkbook } = require('../services/executiveSummaryExcel');
const { buildExecutiveMovementRows, buildExecutiveFinancialChartGroups } = require('../services/executiveSummaryData');

const datoRow = {
  'UNIDAD': 'A-01', 'CLIENTE': 'Cliente Demo', 'ESTATUS': 'CON CPP',
  'PRECIO DE VENTA': 150000, 'MONTO CPP': 120000, 'BANCO DEL CLIENTE': 'Banco Demo',
  'MODELO VIVIENDA': 'Modelo A', 'FECHA DE CONTRATO': new Date('2026-01-15'),
  'NUMERO CPP': 'CPP-1', 'SEXO': 'Mujer', 'TIPO DE EMPRESA': 'Privada'
};

const financeDocument = {
  phases: [{ _id: 'phase-1', name: 'Fase 1', planUses: [{ name: 'Terreno', amount: 100000 }], uses: [{ name: 'Terreno', amount: 90000 }] }],
  loanLines: [{
    _id: 'line-1', phaseId: 'phase-1', name: 'Línea principal', approvedAmount: 200000,
    entries: [{ entryType: 'disbursement', paymentStatus: 'paid', fundingParty: 'bank', movementDate: new Date('2026-02-01'), disbursementAmount: 75000 }]
  }],
  unitAmortizations: [{
    lot: 'A-01', clientName: 'Cliente Demo', checkDate: new Date('2026-03-01'), checkNumber: 'CH-1',
    allocations: [{ loanLineId: 'line-1', loanLineName: 'Línea principal', amount: 10000 }]
  }]
};

test('el Excel ejecutivo contiene cuatro hojas, tablas, fórmulas y gráficas nativas', async () => {
  const movementRows = buildExecutiveMovementRows(financeDocument);
  const chartGroups = [
    {
      section: 'Resumen Comercial', title: 'Estatus lotes / unidades', type: 'doughnut',
      categories: ['Con CPP'], series: [{ name: 'Cantidad', values: [1] }]
    },
    ...buildExecutiveFinancialChartGroups(financeDocument, movementRows)
  ];
  const buffer = await buildExecutiveSummaryWorkbook({
    summary: { projectName: 'Proyecto Demo', updatedAt: new Date('2026-10-28'), units: { total: 1, sold: 1 }, progressPct: 50, salesAmount: 150000, cppAmount: 120000 },
    datoRows: [datoRow], movementRows, chartGroups
  });
  if (process.env.WRITE_EXECUTIVE_XLSX_FIXTURE === '1') {
    const fixtureDir = path.join(process.cwd(), 'tmp', 'spreadsheets');
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(path.join(fixtureDir, 'executive-summary-sample.xlsx'), buffer);
  }

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map(sheet => sheet.name), ['Resumen', 'Dato único', 'Movimientos', 'Gráficas']);
  assert.equal(workbook.getWorksheet('Dato único').getTable('DatoUnicoTable').name, 'DatoUnicoTable');
  assert.equal(workbook.getWorksheet('Movimientos').getTable('MovimientosTable').name, 'MovimientosTable');
  assert.match(workbook.getWorksheet('Resumen').getCell('A6').value.formula, /ROWS\(DatoUnicoTable/);
  assert.ok(workbook.getWorksheet('Gráficas').getCell('J7').value);

  const zip = new PizZip(buffer);
  const chartFiles = Object.keys(zip.files).filter(name => /^xl\/charts\/chart\d+\.xml$/.test(name));
  assert.equal(chartFiles.length, chartGroups.length);
  assert.match(zip.file('xl/worksheets/sheet4.xml').asText(), /<drawing r:id="rIdCharts"\/>/);
  assert.match(zip.file('xl/drawings/drawing1.xml').asText(), /graphicFrame/);
});

test('el Excel ejecutivo también abre cuando todavía no hay filas ni gráficas', async () => {
  const buffer = await buildExecutiveSummaryWorkbook({
    summary: { projectName: 'Proyecto vacío', units: { total: 0, sold: 0 }, progressPct: 0 },
    datoRows: [], movementRows: [], chartGroups: []
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.equal(workbook.worksheets.length, 4);
  assert.ok(workbook.getWorksheet('Dato único').getTable('DatoUnicoTable'));
  assert.ok(workbook.getWorksheet('Movimientos').getTable('MovimientosTable'));
});
