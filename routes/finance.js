// routes/finance.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const ProjectFinance = require('../models/ProjectFinance');
const Project = require('../models/Project');

const fs   = require('fs');
const path = require('path');
const axios = require('axios');

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

/* =========================================================================
   Helpers base
   ========================================================================= */

async function getOrCreate(projectId) {
  let doc = await ProjectFinance.findOne({ project: projectId });
  if (!doc) {
    doc = await ProjectFinance.create({ project: projectId, phases: [] });
  }
  return doc;
}

const toNum = (v) => {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(String(v).replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : 0;
};

const sumItems = (arr = []) => (arr || []).reduce((a, b) => a + toNum(b?.amount), 0);

const fmtDate = (d) => {
  try {
    if (!d) return '—';
    const x = new Date(d);
    return isNaN(x.getTime()) ? '—' : x.toISOString().slice(0, 10);
  } catch {
    return '—';
  }
};

const moneyES = (n) => Number(n || 0).toLocaleString('es-ES');

function resolveLogoPath() {
  const candidates = [
    path.join(process.cwd(), 'assets', 'TrustForBanksLogo.png'),
    path.join(__dirname, '..', 'assets', 'TrustForBanksLogo.png'),
    path.join(process.cwd(), 'public', 'assets', 'TrustForBanksLogo.png'),
    path.join(__dirname, '..', 'public', 'assets', 'TrustForBanksLogo.png'),
    path.join(process.cwd(), 'assets', 'Logovectorizado.png'),
    path.join(__dirname, '..', 'assets', 'Logovectorizado.png'),
  ];
  const found = candidates.find(p => fs.existsSync(p)) || null;
  if (!found) console.warn('[FINANCE EXPORT] Logo NO encontrado. Candidatos:', candidates);
  return found;
}

/* =========================================================================
   KPIs cabecera (igual que tenías)
   ========================================================================= */

async function updateProjectKpis(req, res) {
  try {
    const { projectId } = req.params;
    if (!mongoose.isValidObjectId(projectId)) {
      return res.status(400).json({ error: 'projectId inválido' });
    }

    const p = await Project.findById(projectId);
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const body = req.body || {};

    const FIELD_CANDIDATES = {
      loanApproved:   ['loanApproved','loan_aprobado','loanAprobado','kpiLoanApproved','kpisLoanApproved'],
      disbursed:      ['disbursed','desembolsado','loanDisbursed','loan_desembolsado','kpiDisbursed','kpisDisbursed'],
      budgetApproved: ['budgetApproved','budget_aprobado','budgetAprobado','kpiBudgetApproved','kpisBudgetApproved'],
      spent:          ['spent','gasto','budgetSpent','budget_spent','kpiSpent','kpisSpent'],
      unitsTotal:     ['unitsTotal','unidadesTotales','unidades_totales'],
      unitsSold:      ['unitsSold','unidadesVendidas','unidades_vendidas'],
    };

    const pickExistingField = (candidates) => {
      const obj = p.toObject?.() || p;
      for (const f of candidates) if (f in obj) return f;
      return candidates[0];
    };

    const setIfProvided = (logicalKey) => {
      if (!(logicalKey in body)) return;
      const v = body[logicalKey];
      if (v === '' || v === null || v === undefined) return;
      const value = Number(String(v).replace(/[, ]/g, ''));
      if (!Number.isFinite(value)) return;
      const fieldName = pickExistingField(FIELD_CANDIDATES[logicalKey]);
      p.set(fieldName, value);
    };

    setIfProvided('loanApproved');
    setIfProvided('disbursed');
    setIfProvided('budgetApproved');
    setIfProvided('spent');
    setIfProvided('unitsTotal');
    setIfProvided('unitsSold');

    await p.save();

    const readField = (logicalKey) => {
      const fieldName = pickExistingField(FIELD_CANDIDATES[logicalKey]);
      return Number(p.get(fieldName) || 0);
    };

    return res.json({
      ok: true,
      projectId,
      kpis: {
        loanApproved:   readField('loanApproved'),
        disbursed:      readField('disbursed'),
        budgetApproved: readField('budgetApproved'),
        spent:          readField('spent'),
        unitsTotal:     readField('unitsTotal'),
        unitsSold:      readField('unitsSold'),
      }
    });
  } catch (err) {
    console.error('PUT finance/kpis error', err);
    return res.status(500).json({ error: 'Error al actualizar KPIs del proyecto' });
  }
}

router.put('/projects/:projectId/finance/kpis', updateProjectKpis);
router.put('/projects/:projectId/finance/project-kpis', updateProjectKpis);

/* =========================================================================
   GET finance base
   ========================================================================= */

router.get('/projects/:projectId/finance', async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!mongoose.isValidObjectId(projectId)) {
      return res.status(400).json({ error: 'projectId inválido' });
    }

    const doc = await getOrCreate(projectId);

    // alertas por fin de fase
    const today = new Date();
    const alerts = [];
    for (const ph of (doc.phases || [])) {
      if (!ph?.endDate) continue;
      const daysLeft = Math.ceil((new Date(ph.endDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      if (daysLeft <= (ph.alertDaysBefore ?? 15)) {
        alerts.push({
          phaseId: ph._id,
          phaseName: ph.name,
          daysLeft,
          message: `La fase "${ph.name}" termina en ${Math.max(daysLeft, 0)} días. Preparar desembolso de la siguiente fase.`,
        });
      }
    }

    const kpis = doc.kpis();
    const project = await Project.findById(projectId).lean();

    res.json({ finance: doc, kpis, alerts, project });
  } catch (err) {
    console.error('GET finance error', err);
    res.status(500).json({ error: 'Error al obtener finanzas' });
  }
});

/* =========================================================================
   CRUD fases (igual que tu lógica)
   ========================================================================= */

router.post('/projects/:projectId/finance/phases', async (req, res) => {
  try {
    const { projectId } = req.params;

    const {
      name, startDate, endDate,
      uses = [], sources = [],
      planUses = [], planSources = [],
      disbExpected = 0,
      disbActual = 0,
      disbRequested = false,
      disbRequestedAt = null,
      interesesDevengados = 0,
      aportesPropios = 0,
      preventas = 0,
      alertDaysBefore = 15
    } = req.body || {};

    if (!name || !startDate || !endDate) {
      return res.status(400).json({ error: 'Faltan campos requeridos (name, startDate, endDate)' });
    }

    const doc = await getOrCreate(projectId);
    doc.phases.push({
      name, startDate, endDate,
      uses, sources,
      planUses, planSources,
      disbExpected, disbActual, disbRequested, disbRequestedAt,
      interesesDevengados, aportesPropios, preventas,
      alertDaysBefore
    });

    await doc.save();
    res.json({ ok: true, phases: doc.phases, kpis: doc.kpis() });
  } catch (err) {
    console.error('POST phase error', err);
    res.status(500).json({ error: 'Error al crear fase' });
  }
});

router.put('/projects/:projectId/finance/phases/:phaseId', async (req, res) => {
  try {
    const { projectId, phaseId } = req.params;
    const doc = await getOrCreate(projectId);
    const ph = doc.phases.id(phaseId);
    if (!ph) return res.status(404).json({ error: 'Fase no encontrada' });

    const fields = [
      'name','startDate','endDate',
      'uses','sources',
      'planUses','planSources',
      'disbExpected','disbActual','disbRequested','disbRequestedAt',
      'interesesDevengados','aportesPropios','preventas',
      'alertDaysBefore','alerted'
    ];
    for (const f of fields) if (f in req.body) ph[f] = req.body[f];

    await doc.save();
    res.json({ ok: true, phase: ph, kpis: doc.kpis() });
  } catch (err) {
    console.error('PUT phase error', err);
    res.status(500).json({ error: 'Error al actualizar fase' });
  }
});

router.delete('/projects/:projectId/finance/phases/:phaseId', async (req, res) => {
  try {
    const { projectId, phaseId } = req.params;

    if (!mongoose.isValidObjectId(projectId) || !mongoose.isValidObjectId(phaseId)) {
      return res.status(400).json({ error: 'IDs inválidos' });
    }

    const doc = await getOrCreate(projectId);
    const exists = doc.phases.id(phaseId);
    if (!exists) return res.status(404).json({ error: 'Fase no encontrada' });

    doc.phases = doc.phases.filter(p => String(p._id) !== String(phaseId));
    await doc.save();

    return res.json({ ok: true, phases: doc.phases, kpis: doc.kpis() });
  } catch (err) {
    console.error('DELETE phase error', err);
    return res.status(500).json({ error: 'Error al eliminar fase' });
  }
});

router.patch('/projects/:projectId/finance/phases/:phaseId/preventas', async (req, res) => {
  try {
    const { projectId, phaseId } = req.params;
    const { delta = 0 } = req.body || {};
    const doc = await getOrCreate(projectId);
    const ph = doc.phases.id(phaseId);
    if (!ph) return res.status(404).json({ error: 'Fase no encontrada' });

    ph.preventas = Number(ph.preventas || 0) + Number(delta || 0);
    await doc.save();
    res.json({ ok: true, phase: ph, kpis: doc.kpis() });
  } catch (err) {
    console.error('PATCH preventas error', err);
    res.status(500).json({ error: 'Error al actualizar preventas' });
  }
});

/* =========================================================================
   EXPORT (NUEVO, estilo Summary, sin tocar front)
   - GET /api/projects/:projectId/finance/export?format=pdf|xlsx  (sin charts)
   - POST /api/projects/:projectId/finance/export  (acepta chart/charts/datasets opcional)
   ========================================================================= */

function normalizeExportBody(req) {
  const body = req.body || {};
  const format = String(body.format || body.type || '').toLowerCase();
  const queryFormat = String(req.query?.format || req.query?.type || '').toLowerCase();

  const finalFormat = (format || queryFormat || 'pdf').toLowerCase();
  const safeFormat = (finalFormat === 'xlsx' || finalFormat === 'pdf') ? finalFormat : 'pdf';

  // Compat:
  // - chart: 'data:image/png;base64,...'
  // - charts: { title: dataUrl, ... }
  // - datasets: cualquier objeto extra
  const chart = (typeof body.chart === 'string') ? body.chart : null;
  const charts = (body.charts && typeof body.charts === 'object') ? body.charts : null;
  const datasets = (body.datasets && typeof body.datasets === 'object') ? body.datasets : {};

  return { format: safeFormat, chart, charts, datasets };
}

function dataUrlToBuffer(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return null;
  const m = dataUrl.match(/^data:image\/(png|jpe?g);base64,(.+)$/i);
  if (!m) return null;
  return Buffer.from(m[2], 'base64');
}

async function urlToBuffer(url, req) {
  if (!url || typeof url !== 'string') return null;
  if (/^data:image\//i.test(url)) return dataUrlToBuffer(url);
  if (!/^https?:\/\//i.test(url)) return null;

  try {
    const auth = req.headers.authorization;
    const r = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: auth ? { Authorization: auth } : undefined
    });
    return Buffer.from(r.data);
  } catch (e) {
    console.warn('[FINANCE EXPORT] No pude descargar imagen:', url, e?.message || e);
    return null;
  }
}

function buildFinanceSnapshot(doc) {
  const phases = (doc.phases || []).map(p => {
    const planUses = sumItems(p.planUses);
    const planSources = sumItems(p.planSources);
    const realUses = sumItems(p.uses);
    const realSources = sumItems(p.sources);

    return {
      id: String(p._id),
      name: p.name || 'Fase',
      startDate: p.startDate,
      endDate: p.endDate,
      planUses,
      planSources,
      realUses,
      realSources,
      disbExpected: toNum(p.disbExpected),
      disbActual: toNum(p.disbActual),
      disbRequested: !!p.disbRequested,
      disbRequestedAt: p.disbRequestedAt || null,
      intereses: toNum(p.interesesDevengados),
      aportes: toNum(p.aportesPropios),
      preventas: toNum(p.preventas),
      uses: Array.isArray(p.uses) ? p.uses : [],
      sources: Array.isArray(p.sources) ? p.sources : [],
      planUsesItems: Array.isArray(p.planUses) ? p.planUses : [],
      planSourcesItems: Array.isArray(p.planSources) ? p.planSources : [],
    };
  });

  // Totales por fases (plan y real)
  const totals = phases.reduce((acc, p) => {
    acc.planUses += p.planUses;
    acc.planSources += p.planSources;
    acc.realUses += p.realUses;
    acc.realSources += p.realSources;

    acc.disbExpected += p.disbExpected;
    acc.disbActual += p.disbActual;

    acc.intereses += p.intereses;
    acc.aportes += p.aportes;
    acc.preventas += p.preventas;

    if (p.disbRequested) acc.disbRequestedCount += 1;
    return acc;
  }, {
    planUses:0, planSources:0, realUses:0, realSources:0,
    disbExpected:0, disbActual:0, disbRequestedCount:0,
    intereses:0, aportes:0, preventas:0
  });

  const percentExecution = totals.planUses > 0 ? (totals.realUses / totals.planUses) : 0;

  return { phases, totals, percentExecution };
}

function styleSheetHeaderRow(row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.alignment = { vertical: 'middle' };
  row.fill = { type: 'pattern', pattern:'solid', fgColor:{ argb:'FF0B3B2E' } }; // verde oscuro
}

function autoFitColumns(ws, max = 60) {
  ws.columns.forEach(col => {
    let m = 10;
    col.eachCell({ includeEmpty: true }, c => {
      const v = c.value;
      const len = (v === null || v === undefined) ? 0 : String(v).length;
      if (len > m) m = len;
    });
    col.width = Math.min(max, Math.max(10, m + 2));
  });
}

async function exportFinanceXlsx({ req, res, projectId, projectName, updatedAt, doc, kpis, chartsPayload }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TrustForBanks';
  wb.created = new Date();

  const snap = buildFinanceSnapshot(doc);

  // ===== Hoja Resumen =====
  const sh0 = wb.addWorksheet('Resumen');
  sh0.columns = [{ width: 34 }, { width: 26 }, { width: 26 }, { width: 26 }];

  sh0.getCell('A1').value = 'Resumen financiero — Proyecto';
  sh0.getCell('A1').font = { bold: true, size: 14 };

  sh0.addRow(['Proyecto', projectName || String(projectId)]);
  sh0.addRow(['Actualizado', updatedAt ? new Date(updatedAt).toLocaleString() : '—']);
  sh0.addRow([]);

  sh0.addRow(['PLAN (por fases) - Usos', snap.totals.planUses]);
  sh0.addRow(['PLAN (por fases) - Fuentes', snap.totals.planSources]);
  sh0.addRow(['REAL (sum fases) - Usos', snap.totals.realUses]);
  sh0.addRow(['REAL (sum fases) - Fuentes', snap.totals.realSources]);

  sh0.addRow(['% Ejecución (Real/Plan usos)', `${(snap.percentExecution * 100).toFixed(1)}%`]);
  sh0.addRow(['Intereses acumulados', snap.totals.intereses]);
  sh0.addRow(['Preventas acumuladas', snap.totals.preventas]);
  sh0.addRow(['Aportes propios acumulados', snap.totals.aportes]);

  sh0.addRow([]);
  sh0.addRow(['Desembolso esperado (total)', snap.totals.disbExpected]);
  sh0.addRow(['Desembolso real (total)', snap.totals.disbActual]);
  sh0.addRow(['Fases con desembolso solicitado', snap.totals.disbRequestedCount]);

  // Formato numérico
  for (let r = 4; r <= sh0.rowCount; r++) {
    const v = sh0.getCell(`B${r}`).value;
    if (typeof v === 'number') sh0.getCell(`B${r}`).numFmt = '#,##0';
  }

  // ===== Hoja Fases (tabla compacta) =====
  const sh1 = wb.addWorksheet('Fases');
  sh1.addRow([
    'Fase','Inicio','Fin',
    'Plan Usos','Plan Fuentes',
    'Real Usos','Real Fuentes',
    'Desembolso esperado','Desembolso real','Solicitado','Solicitado at',
    'Intereses','Aportes','Preventas'
  ]);
  styleSheetHeaderRow(sh1.getRow(1));

  snap.phases.forEach(p => {
    sh1.addRow([
      p.name,
      p.startDate ? new Date(p.startDate) : '',
      p.endDate ? new Date(p.endDate) : '',
      p.planUses, p.planSources,
      p.realUses, p.realSources,
      p.disbExpected, p.disbActual,
      p.disbRequested ? 'SI' : 'NO',
      p.disbRequestedAt ? new Date(p.disbRequestedAt) : '',
      p.intereses, p.aportes, p.preventas
    ]);
  });

  // Formato columnas
  const numCols = [4,5,6,7,8,9,12,13,14];
  for (let r = 2; r <= sh1.rowCount; r++) {
    for (const c of numCols) sh1.getRow(r).getCell(c).numFmt = '#,##0';
  }
  sh1.getColumn(2).numFmt = 'yyyy-mm-dd';
  sh1.getColumn(3).numFmt = 'yyyy-mm-dd';
  sh1.getColumn(11).numFmt = 'yyyy-mm-dd';

  autoFitColumns(sh1, 52);

  // ===== Hoja Detalle por fase =====
  const sh2 = wb.addWorksheet('Detalle Fase');
  sh2.addRow(['Fase', 'Tipo', 'Partida', 'Monto']);
  styleSheetHeaderRow(sh2.getRow(1));
  sh2.columns = [{ width: 26 }, { width: 16 }, { width: 46 }, { width: 16 }];

  for (const p of snap.phases) {
    const pushBlock = (type, items) => {
      (items || []).forEach(it => {
        sh2.addRow([p.name, type, String(it?.name || '—'), toNum(it?.amount)]);
      });
    };
    pushBlock('PLAN_USOS', p.planUsesItems);
    pushBlock('PLAN_FUENTES', p.planSourcesItems);
    pushBlock('REAL_USOS', p.uses);
    pushBlock('REAL_FUENTES', p.sources);

    // separador
    sh2.addRow(['', '', '', '']);
  }
  // numFmt montos
  for (let r = 2; r <= sh2.rowCount; r++) {
    const v = sh2.getRow(r).getCell(4).value;
    if (typeof v === 'number') sh2.getRow(r).getCell(4).numFmt = '#,##0';
  }

  // ===== Hoja Desembolsos =====
  const sh3 = wb.addWorksheet('Desembolsos');
  sh3.addRow(['Fase','Esperado','Real','Solicitado','Solicitado at']);
  styleSheetHeaderRow(sh3.getRow(1));
  sh3.columns = [{ width: 30 }, { width: 16 }, { width: 16 }, { width: 12 }, { width: 18 }];
  snap.phases.forEach(p => {
    sh3.addRow([
      p.name,
      p.disbExpected,
      p.disbActual,
      p.disbRequested ? 'SI' : 'NO',
      p.disbRequestedAt ? new Date(p.disbRequestedAt) : ''
    ]);
  });
  for (let r = 2; r <= sh3.rowCount; r++) {
    sh3.getRow(r).getCell(2).numFmt = '#,##0';
    sh3.getRow(r).getCell(3).numFmt = '#,##0';
  }
  sh3.getColumn(5).numFmt = 'yyyy-mm-dd';

  // ===== Hoja Gráficas (si llegan) =====
  const charts = chartsPayload || {};
  const chartEntries = Object.entries(charts).filter(([_, v]) => typeof v === 'string' && v.startsWith('data:image/'));
  if (chartEntries.length) {
    const shC = wb.addWorksheet('Gráficas');
    shC.getCell('A1').value = 'Gráficas';
    shC.getRow(1).font = { bold: true, size: 14 };
    let row = 3;

    for (const [title, dataUrl] of chartEntries) {
      const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(String(dataUrl));
      if (!m) continue;

      shC.getCell(`A${row}`).value = title;
      shC.getRow(row).font = { bold: true };
      row += 1;

      const imgId = wb.addImage({ base64: m[2], extension: 'png' });
      shC.addImage(imgId, { tl: { col: 0, row }, ext: { width: 900, height: 340 } });
      row += 20;
    }
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="finanzas_${projectId}.xlsx"`);
  await wb.xlsx.write(res);
  return res.end();
}

function pdfRoundRect(doc, x, y, w, h, r) {
  if (typeof doc.roundRect === 'function') return doc.roundRect(x, y, w, h, r);
  if (typeof doc.roundedRect === 'function') return doc.roundedRect(x, y, w, h, r);

  r = Math.min(r, w / 2, h / 2);
  doc
    .moveTo(x + r, y)
    .lineTo(x + w - r, y)
    .quadraticCurveTo(x + w, y, x + w, y + r)
    .lineTo(x + w, y + h - r)
    .quadraticCurveTo(x + w, y + h, x + w - r, y + h)
    .lineTo(x + r, y + h)
    .quadraticCurveTo(x, y + h, x, y + h - r)
    .lineTo(x, y + r)
    .quadraticCurveTo(x, y, x + r, y)
    .closePath();
  return doc;
}

function financePdfHeader(doc, { projectName, updatedAt }) {
  const margin = doc.page.margins.left;
  const pageW = doc.page.width;

  const logoPath = resolveLogoPath();

  // banda superior
  doc.save();
  doc.rect(0, 0, pageW, 84).fill('#0B3B2E');
  doc.restore();

  // logo
  if (logoPath) {
    try { doc.image(logoPath, margin, 18, { width: 120 }); } catch (_) {}
  }

  doc.fontSize(18).fillColor('white')
    .text('Finanzas — Resumen ejecutivo', margin + 140, 22, { width: pageW - margin*2 - 140 });

  doc.fontSize(10).fillColor('#D1FAE5')
    .text(`Proyecto: ${projectName || 'Proyecto'}`, margin + 140, 48, { width: pageW - margin*2 - 140 });

  doc.fontSize(9).fillColor('#A7F3D0')
    .text(`Actualizado: ${updatedAt ? new Date(updatedAt).toLocaleString() : '—'}`, margin + 140, 64, { width: pageW - margin*2 - 140 });

  doc.y = 98;
}

function financePdfFooter(doc, { page, total, projectName }) {
  const left   = doc.page.margins.left;
  const right  = doc.page.margins.right;
  const bottom = doc.page.margins.bottom;
  const pageW = doc.page.width;
  const pageH = doc.page.height;

  const y = pageH - bottom - 12;

  doc.save();
  doc.fontSize(8).fillColor('#6b7280');
  doc.text(projectName ? String(projectName) : 'Proyecto', left, y, { align: 'left' });
  doc.text(`Página ${page}/${total}`, left, y, { align: 'right', width: pageW - left - right });
  doc.restore();
}

function financePdfSection(doc, title) {
  const margin = doc.page.margins.left;
  doc.moveDown(0.6);
  doc.fontSize(12).fillColor('#111827').text(title, margin);
  doc.moveDown(0.2);
  doc.save();
  doc.lineWidth(0.5).moveTo(margin, doc.y).lineTo(doc.page.width - margin, doc.y).stroke('#e5e7eb');
  doc.restore();
  doc.moveDown(0.6);
}

function financePdfKpiCards(doc, snap) {
  const margin = doc.page.margins.left;
  const pageW = doc.page.width;
  const contentW = pageW - margin*2;

  const cardW = (contentW - 12) / 2;
  const cardH = 64;

  const kpis = [
    { label: 'Ejecución (Real/Plan usos)', value: `${(snap.percentExecution * 100).toFixed(1)}%` },
    { label: 'Intereses acumulados', value: moneyES(snap.totals.intereses) },
    { label: 'Preventas acumuladas', value: moneyES(snap.totals.preventas) },
    { label: 'Desembolso real (total)', value: moneyES(snap.totals.disbActual) },
  ];

  const drawCard = (x, y, { label, value }) => {
    doc.save();
    pdfRoundRect(doc, x, y, cardW, cardH, 10).fill('#F3F4F6');
    pdfRoundRect(doc, x, y, cardW, cardH, 10).stroke('#E5E7EB');
    doc.restore();

    doc.fontSize(9).fillColor('#6B7280').text(label, x + 12, y + 10, { width: cardW - 24 });
    doc.fontSize(16).fillColor('#111827').text(value, x + 12, y + 28, { width: cardW - 24 });
  };

  const y0 = doc.y;
  const x1 = margin;
  const x2 = margin + cardW + 12;

  drawCard(x1, y0, kpis[0]);
  drawCard(x2, y0, kpis[1]);
  drawCard(x1, y0 + cardH + 12, kpis[2]);
  drawCard(x2, y0 + cardH + 12, kpis[3]);

  doc.y = y0 + (cardH * 2) + 28;
}

function financePdfEnsureSpace(doc, h) {
  const bottomSafe = doc.page.height - doc.page.margins.bottom - 60;
  if (doc.y + h > bottomSafe) doc.addPage();
}

function financePdfTable(doc, rows, cols) {
  const margin = doc.page.margins.left;
  const width = doc.page.width - margin * 2;

  // cols: [{ key, label, wPct, align }]
  const colW = cols.map(c => Math.floor(width * c.wPct));

  // ✅ Normaliza rows
  const safeRows = Array.isArray(rows) ? rows : [];

  // ✅ Si no hay datos: NO pintes tabla (evita páginas vacías con headers)
  if (safeRows.length === 0) {
    financePdfEnsureSpace(doc, 18);
    doc.fontSize(9).fillColor('#6b7280').text('— Sin datos —', margin, doc.y);
    doc.moveDown(0.8);
    doc.fillColor('#111827');
    return;
  }

  const HEADER_H = 26; // header + línea
  const ROW_H = 16;    // alto aprox de cada fila

  // ✅ Clave: antes de pintar header, debe caber header + 1 fila
  financePdfEnsureSpace(doc, HEADER_H + ROW_H);

  const drawHeader = () => {
    const y0 = doc.y;

    doc.save();
    doc.fontSize(9).fillColor('#6b7280');

    let x = margin;
    cols.forEach((c, i) => {
      doc.text(c.label, x, y0, { width: colW[i], align: c.align || 'left' });
      x += colW[i];
    });

    doc.restore();

    doc.moveDown(0.4);
    doc.save();
    doc.moveTo(margin, doc.y).lineTo(doc.page.width - margin, doc.y).stroke('#e5e7eb');
    doc.restore();
    doc.moveDown(0.2);

    doc.fontSize(9).fillColor('#111827');
  };

  // Header
  drawHeader();

  // ✅ Si justo después del header no cabe una fila, saltamos y repetimos header
  financePdfEnsureSpace(doc, ROW_H);
  if (doc.y + ROW_H > (doc.page.height - doc.page.margins.bottom - 60)) {
    doc.addPage();
    financePdfHeader(doc, {
      projectName: doc.__projectName || null,
      updatedAt: doc.__updatedAt || null
    });
    drawHeader();
  }

  // Rows
  for (const r of safeRows) {
    // Si no cabe una fila, nueva página + header + header tabla
    const bottomSafe = doc.page.height - doc.page.margins.bottom - 60;
    if (doc.y + ROW_H > bottomSafe) {
      doc.addPage();
      financePdfHeader(doc, {
        projectName: doc.__projectName || null,
        updatedAt: doc.__updatedAt || null
      });
      drawHeader();
    }

    let x = margin;
    cols.forEach((c, i) => {
      const v = (r[c.key] === null || r[c.key] === undefined) ? '' : String(r[c.key]);
      doc.text(v, x, doc.y, { width: colW[i], align: c.align || 'left' });
      x += colW[i];
    });

    doc.moveDown(0.2);
  }

  doc.moveDown(0.8);
}

async function exportFinancePdf({ req, res, projectId, projectName, updatedAt, doc, chartsPayload }) {
  const snap = buildFinanceSnapshot(doc);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="finanzas_${projectId}.pdf"`);

  // bufferPages para footer con total
  const pdf = new PDFDocument({ margin: 40, bufferPages: true });
  pdf.pipe(res);

  // Portada + header
  financePdfHeader(pdf, { projectName, updatedAt });
  pdf.__projectName = projectName;
  pdf.__updatedAt = updatedAt;

  // KPI cards
  financePdfKpiCards(pdf, snap);

  // Charts opcionales (si llegan)
  const charts = chartsPayload || {};
  const chartEntries = Object.entries(charts).filter(([_, v]) => typeof v === 'string' && v);
  if (chartEntries.length) {
    financePdfSection(pdf, 'Gráficas');
    for (const [title, src] of chartEntries) {
      const buf = await urlToBuffer(src, req);
      if (!buf) continue;

      pdf.fontSize(11).fillColor('#111827').text(title);
      pdf.moveDown(0.3);

      const imgTop = pdf.y;
      const imgH = 260;
      pdf.image(buf, pdf.page.margins.left, imgTop, {
        fit: [pdf.page.width - pdf.page.margins.left*2, imgH],
        align: 'center'
      });
      pdf.y = imgTop + imgH + 12;
      financePdfEnsureSpace(pdf, 40);
    }
  }

  // Resumen financiero
  financePdfSection(pdf, 'Resumen financiero (plan vs real)');
  financePdfTable(pdf, [
    { c:'Plan usos', v: moneyES(snap.totals.planUses) },
    { c:'Plan fuentes', v: moneyES(snap.totals.planSources) },
    { c:'Real usos', v: moneyES(snap.totals.realUses) },
    { c:'Real fuentes', v: moneyES(snap.totals.realSources) },
    { c:'Ejecución', v: `${(snap.percentExecution * 100).toFixed(1)}%` },
    { c:'Intereses', v: moneyES(snap.totals.intereses) },
    { c:'Preventas', v: moneyES(snap.totals.preventas) },
    { c:'Aportes propios', v: moneyES(snap.totals.aportes) },
    { c:'Desembolso esperado', v: moneyES(snap.totals.disbExpected) },
    { c:'Desembolso real', v: moneyES(snap.totals.disbActual) },
    { c:'Fases solicitadas', v: String(snap.totals.disbRequestedCount) },
  ], [
    { key:'c', label:'Concepto', wPct:0.66, align:'left' },
    { key:'v', label:'Valor', wPct:0.34, align:'right' },
  ]);

  // Tabla compacta de fases
  financePdfSection(pdf, 'Fases (resumen)');
  const rows = snap.phases.map(p => ({
    phase: p.name,
    dates: `${fmtDate(p.startDate)} → ${fmtDate(p.endDate)}`,
    plan: moneyES(p.planUses),
    real: moneyES(p.realUses),
    disb: `${moneyES(p.disbActual)}${p.disbRequested ? ' (SOL)' : ''}`,
  }));
  financePdfTable(pdf, rows, [
    { key:'phase', label:'Fase', wPct:0.34, align:'left' },
    { key:'dates', label:'Fechas', wPct:0.26, align:'left' },
    { key:'plan',  label:'Plan usos', wPct:0.14, align:'right' },
    { key:'real',  label:'Real usos', wPct:0.14, align:'right' },
    { key:'disb',  label:'Desembolso', wPct:0.12, align:'right' },
  ]);

  // Detalle por fase (compacto)
  for (const p of snap.phases) {
    pdf.addPage();
    financePdfHeader(pdf, { projectName, updatedAt });

    financePdfSection(pdf, `Detalle — ${p.name}`);

    pdf.fontSize(10).fillColor('#374151')
      .text(`Fechas: ${fmtDate(p.startDate)} → ${fmtDate(p.endDate)}`);
    pdf.moveDown(0.4);

    financePdfTable(pdf, [
      { c:'Plan usos', v: moneyES(p.planUses) },
      { c:'Plan fuentes', v: moneyES(p.planSources) },
      { c:'Real usos', v: moneyES(p.realUses) },
      { c:'Real fuentes', v: moneyES(p.realSources) },
      { c:'Intereses', v: moneyES(p.intereses) },
      { c:'Preventas', v: moneyES(p.preventas) },
      { c:'Aportes', v: moneyES(p.aportes) },
      { c:'Desembolso esperado', v: moneyES(p.disbExpected) },
      { c:'Desembolso real', v: moneyES(p.disbActual) },
      { c:'Solicitado', v: p.disbRequested ? 'SI' : 'NO' },
    ], [
      { key:'c', label:'Concepto', wPct:0.66, align:'left' },
      { key:'v', label:'Valor', wPct:0.34, align:'right' },
    ]);

    const mkRows = (items) => (items || []).map(it => ({
      n: String(it?.name || '—'),
      a: moneyES(it?.amount || 0)
    }));

    financePdfSection(pdf, 'PLAN — Usos');
    financePdfTable(pdf, mkRows(p.planUsesItems), [
      { key:'n', label:'Partida', wPct:0.72, align:'left' },
      { key:'a', label:'Monto', wPct:0.28, align:'right' },
    ]);

    financePdfSection(pdf, 'PLAN — Fuentes');
    financePdfTable(pdf, mkRows(p.planSourcesItems), [
      { key:'n', label:'Partida', wPct:0.72, align:'left' },
      { key:'a', label:'Monto', wPct:0.28, align:'right' },
    ]);

    financePdfSection(pdf, 'REAL — Usos');
    financePdfTable(pdf, mkRows(p.uses), [
      { key:'n', label:'Partida', wPct:0.72, align:'left' },
      { key:'a', label:'Monto', wPct:0.28, align:'right' },
    ]);

    financePdfSection(pdf, 'REAL — Fuentes');
    financePdfTable(pdf, mkRows(p.sources), [
      { key:'n', label:'Partida', wPct:0.72, align:'left' },
      { key:'a', label:'Monto', wPct:0.28, align:'right' },
    ]);
  }

  // Footer con total páginas (2ª pasada)
  const range = pdf.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    pdf.switchToPage(i);
    financePdfFooter(pdf, {
      page: i + 1,
      total: range.count,
      projectName: projectName || String(projectId)
    });
  }

  pdf.end();
}

async function handleFinanceExport(req, res) {
  try {
    const { projectId } = req.params;
    if (!mongoose.isValidObjectId(projectId)) {
      return res.status(400).json({ error: 'projectId inválido' });
    }

    const { format, chart, charts } = normalizeExportBody(req);

    const doc = await getOrCreate(projectId);
    const kpis = doc.kpis ? doc.kpis() : {};

    const project = await Project.findById(projectId).lean().catch(() => null);
    const projectName = project?.name || 'Proyecto';
    const updatedAt = project?.updatedAt || doc?.updatedAt || new Date();

    // chartsPayload: compat (chart único => lo metemos como "Plan vs Real")
    const chartsPayload = (() => {
      const out = {};
      if (charts && typeof charts === 'object') Object.assign(out, charts);
      if (chart && typeof chart === 'string') out['Plan vs Real (acumulado)'] = chart;
      return out;
    })();

    if (format === 'xlsx') {
      return exportFinanceXlsx({
        req, res, projectId, projectName, updatedAt, doc, kpis, chartsPayload
      });
    }

    // pdf
    return exportFinancePdf({
      req, res, projectId, projectName, updatedAt, doc, chartsPayload
    });

  } catch (err) {
    console.error('[FINANCE EXPORT] error:', err);
    res.status(500).json({ error: 'Error en exportación' });
  }
}

// ✅ Mantén compat con tu front actual
router.get('/projects/:projectId/finance/export', handleFinanceExport);
router.post('/projects/:projectId/finance/export', handleFinanceExport);

module.exports = router;
