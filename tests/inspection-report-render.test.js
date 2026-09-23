'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');
const PDFDocument = require('pdfkit');
const PizZip = require('pizzip');
const { renderInspectionReport } = require('../services/inspectionReport');
const { buildInspectionReportDocx } = require('../services/inspectionReportDocx');

test('professional report renders every main section from one InspectionReportContext', async () => {
  const context = {
    schemaVersion: 1,
    project: { name: 'Residencial Prueba', type: 'Vivienda', currency: 'USD', location: { city: 'Panamá' }, legal: {}, technical: {} },
    participants: { bank: { name: 'Banco Prueba' }, promoter: { name: 'Promotor Prueba' } },
    inspection: { sequence: 2, reportNumber: 'B73-2026-0002', inspectionDate: new Date(), physicalProgressPercent: 45, commonAreas: [] },
    metrics: { physicalProgress: { previousPercent: 30, currentPercent: 45, periodIncrementPercent: 15 }, administrativeProgress: { percent: 70 }, financialProgress: { percent: 40 } },
    finance: { summary: { budgetApproved: 1000000, loanApproved: 700000, totalDisbursed: 200000 }, financialConditions: {}, loanLines: [], unitAmortizations: [] },
    planning: { phases: [] },
    compliance: { permits: [], requirements: [], policies: [] },
    inventory: { models: [] },
    workFronts: [{ name: 'Torre 1', status: 'in_progress', previousPercent: 30, currentPercent: 45, periodIncrementPercent: 15, plannedPercent: 50 }],
    unitProgressComparisons: [], pendingIssues: [], photos: [],
    visit: { generalObservations: 'Visita ejecutada.', incidents: [], qualityObservations: 'Conforme.', environmentalObservations: 'Conforme.', recommendation: { verdict: 'favorable', notes: 'Continuar.' }, conclusion: 'Continuar.' },
    signature: { signerName: 'Perito', signedAt: new Date() }, audit: { snapshotCapturedAt: new Date() }
  };
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true });
  const stream = new PassThrough();
  const chunks = [];
  stream.on('data', chunk => chunks.push(chunk));
  const ended = new Promise((resolve, reject) => stream.on('end', resolve).on('error', reject));
  doc.pipe(stream);
  await renderInspectionReport(doc, { context });
  doc.end();
  await ended;
  const result = Buffer.concat(chunks);
  assert.equal(result.subarray(0, 4).toString(), '%PDF');
  assert.ok(result.length > 4000);
});

test('editable Word report is generated from the same inspection context', () => {
  const context = {
    schemaVersion: 4,
    project: { name: 'Residencial Prueba', description: 'Descripción Bank73', currency: 'USD', location: {}, legal: {}, technical: {} },
    participants: { bank: { name: 'Banco Prueba' }, promoter: { name: 'Promotor Prueba' } },
    inspection: { sequence: 2, reportNumber: 'B73-2026-0002', inspectionDate: new Date() },
    metrics: { physicalProgress: { previousPercent: 30, currentPercent: 45, periodIncrementPercent: 15 }, financialProgress: { percent: 40 } },
    finance: { summary: {}, loanLines: [], unitAmortizations: [] },
    planning: { phases: [], summary: {} },
    compliance: { permits: [], requirements: [], financingConditions: [], planRequirements: [], constructionContracts: [], policies: [], bonds: [], environmentalRequirements: [] },
    inventory: { models: [], folders: [], units: [] },
    workFronts: [], photos: [],
    visit: { reportDetails: { projectDescription: 'Descripción certificada', plans: { status: 'yes' }, workChanges: { hasChanges: false }, budgetAdjustments: { hasAdjustments: false } }, incidents: [], conclusion: 'Continuar.', recommendation: { verdict: 'favorable' } },
    signature: {
      signerName: 'Perito',
      signedAt: new Date(),
      imageData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAEAQH/1f52YQAAAABJRU5ErkJggg=='
    }
  };
  const result = buildInspectionReportDocx(context);
  assert.equal(result.subarray(0, 2).toString(), 'PK');
  const zip = new PizZip(result);
  const documentXml = zip.file('word/document.xml').asText();
  assert.match(documentXml, /Descripción certificada/);
  assert.match(documentXml, /Certificamos que este informe/);
  assert.ok(zip.file('word/media/signature.png'));
  assert.match(zip.file('word/_rels/document.xml.rels').asText(), /rIdSignature/);
  assert.match(documentXml, /No hay fotografías disponibles/);
  assert.ok(result.length > 5000);
});
