'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('stream');
const PDFDocument = require('pdfkit');
const { renderInspectionReport } = require('../services/inspectionReport');

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
