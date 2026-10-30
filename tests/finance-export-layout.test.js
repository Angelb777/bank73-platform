const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');

const financeRouter = require('../routes/finance');
const { buildFinanceSnapshot, exportFinanceXlsx, exportFinancePdf } = financeRouter.__financeExport;

function sampleFinanceDocument() {
  return {
    phases: [{
      _id: 'phase-1',
      name: 'Fase 1',
      startDate: new Date('2026-01-01T00:00:00Z'),
      endDate: new Date('2026-12-31T00:00:00Z'),
      planUses: [{ name: 'Terreno', amount: 650000 }, { name: 'Construcción', amount: 850000 }],
      planSources: [{ name: 'Banco', amount: 1400000 }, { name: 'Promotor', amount: 100000 }],
      uses: [{ name: 'Terreno', amount: 650000 }, { name: 'Construcción', amount: 500000 }],
      sources: [{ name: 'Banco', amount: 1050000 }, { name: 'Promotor', amount: 100000 }],
      disbExpected: 100000,
      disbActual: 75000,
      disbRequested: true,
      disbRequestedAt: new Date('2026-03-01T00:00:00Z'),
      interesesDevengados: 12000,
      aportesPropios: 100000,
      preventas: 0
    }],
    loanLines: [{
      _id: 'line-1',
      phaseId: 'phase-1',
      name: 'Terreno',
      approvedAmount: 650000,
      approvedAmountMode: 'auto',
      notes: '',
      entries: [{
        entryType: 'disbursement',
        paymentStatus: 'disbursed',
        fundingParty: 'bank',
        disbursementAmount: 650000,
        movementDate: new Date('2026-01-15T00:00:00Z'),
        loanNumber: 'PREST-1',
        amortizedAmount: 0,
        interestAmount: 0
      }, {
        entryType: 'manual_amortization',
        paymentStatus: 'legacy',
        fundingParty: 'bank',
        disbursementAmount: 0,
        movementDate: new Date('2026-02-15T00:00:00Z'),
        amortizedAmount: 100000,
        interestAmount: 0
      }, {
        entryType: 'interest_payment',
        paymentStatus: 'legacy',
        fundingParty: 'bank',
        disbursementAmount: 0,
        movementDate: new Date('2026-02-15T00:00:00Z'),
        amortizedAmount: 0,
        interestAmount: 5000
      }]
    }],
    unitAmortizations: [{
      lot: '1-A1',
      clientName: 'Cliente prueba',
      checkDate: new Date('2026-03-15T00:00:00Z'),
      checkNumber: 'CHK-1',
      allocations: [{ loanLineId: 'line-1', loanLineName: 'Terreno', amount: 25000 }]
    }]
  };
}

function captureResponse() {
  const response = new PassThrough();
  const chunks = [];
  response.headers = {};
  response.setHeader = (name, value) => { response.headers[String(name).toLowerCase()] = value; };
  response.on('data', chunk => chunks.push(Buffer.from(chunk)));
  return { response, buffer: () => Buffer.concat(chunks) };
}

test('finance snapshot reconciles banking totals without changing source KPIs', () => {
  const snapshot = buildFinanceSnapshot(sampleFinanceDocument(), 'phase-1');
  assert.equal(snapshot.banking.approved, 650000);
  assert.equal(snapshot.banking.bankDisbursed, 650000);
  assert.equal(snapshot.banking.manualAmortized, 100000);
  assert.equal(snapshot.banking.salesAmortized, 25000);
  assert.equal(snapshot.banking.amortized, 125000);
  assert.equal(snapshot.banking.interestPaid, 5000);
  assert.equal(snapshot.banking.totalPaidToBank, 130000);
  assert.equal(snapshot.banking.outstandingPrincipal, 525000);
  assert.equal(snapshot.banking.availableToDraw, 0);
  assert.equal(snapshot.totals.disbActual, 75000);
});

test('Excel export contains the redesigned financial views and totals', async () => {
  const { response, buffer } = captureResponse();
  const finished = new Promise((resolve, reject) => response.once('finish', resolve).once('error', reject));
  await exportFinanceXlsx({
    req: {}, response, res: response,
    projectId: 'project-1', projectName: 'Proyecto prueba', projectCurrency: 'PAB',
    updatedAt: new Date('2026-04-01T00:00:00Z'), doc: sampleFinanceDocument(), chartsPayload: {}, phaseId: 'phase-1',
    commercialUnits: [{
      unitLabel: '1-A1', clientName: 'Cliente prueba',
      customerPaymentAccounts: [{
        concept: 'Abono del cliente', recipient: 'promoter', summary: { agreed: 6000, status: 'partial' },
        payments: [{ paymentDate: new Date('2026-03-20T00:00:00Z'), recipient: 'bank', receiptNumber: 'REC-9', amount: 1000 }]
      }]
    }]
  });
  await finished;
  const output = buffer();
  if (process.env.WRITE_FINANCE_EXPORT_FIXTURES === '1') {
    const outputDir = path.join(process.cwd(), 'tmp', 'finance-export-preview');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'finance-preview.xlsx'), output);
  }
  const workbook = XLSX.read(output, { type: 'buffer' });
  assert.deepEqual(workbook.SheetNames, ['Resumen', 'Usos y fuentes', 'Líneas bancarias', 'Movimientos', 'Abonos clientes']);
  const summary = XLSX.utils.sheet_to_json(workbook.Sheets.Resumen, { header: 1, defval: null });
  assert.equal(summary[4][0], 'Financiación aprobada');
  assert.equal(summary[5][0], 650000);
  assert.equal(summary[7][4], 'Capital pendiente');
  assert.equal(summary[8][4], 525000);
  assert.equal(summary[8][2], 131000);
  const lines = XLSX.utils.sheet_to_json(workbook.Sheets['Líneas bancarias'], { header: 1, defval: null });
  assert.equal(lines[4][10], 'Total pagado banco');
  assert.equal(lines[4].includes('Cálculo'), false);
  assert.equal(lines[4][13], 'Notas');
  assert.equal(lines.at(-1)[10], 130000);
  const payments = XLSX.utils.sheet_to_json(workbook.Sheets['Abonos clientes'], { header: 1, defval: null });
  assert.equal(payments[4][0], 'Unidad');
  assert.equal(payments[4][9], 'Saldo pendiente');
  assert.equal(payments[5][0], '1-A1');
  assert.equal(payments[5][2], 'Cliente prueba');
  assert.equal(payments[5][3], 'Banco');
  assert.equal(payments[5][5], 'REC-9');
  assert.equal(payments[5][9], 5000);
  assert.equal(payments[4].includes('Notas'), false);
});

test('PDF export produces a non-empty landscape report', async () => {
  const { response, buffer } = captureResponse();
  const finished = new Promise((resolve, reject) => response.once('finish', resolve).once('error', reject));
  await exportFinancePdf({
    req: {}, res: response,
    projectId: 'project-1', projectName: 'Proyecto prueba', projectCurrency: 'PAB',
    updatedAt: new Date('2026-04-01T00:00:00Z'), doc: sampleFinanceDocument(), chartsPayload: {}, phaseId: 'phase-1'
  });
  await finished;
  const output = buffer();
  if (process.env.WRITE_FINANCE_EXPORT_FIXTURES === '1') {
    const outputDir = path.join(process.cwd(), 'tmp', 'finance-export-preview');
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(path.join(outputDir, 'finance-preview.pdf'), output);
  }
  assert.equal(output.subarray(0, 4).toString(), '%PDF');
  assert.ok(output.length > 5000);
});
