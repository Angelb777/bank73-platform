// routes/finance.js
const express = require('express');
const router = express.Router();
const bankReadOnly = require('../middleware/bankReadOnly');
const mongoose = require('mongoose');

const ProjectFinance = require('../models/ProjectFinance');
const Project = require('../models/Project');
const Unit = require('../models/Unit');
const Venta = require('../models/Venta');
const User = require('../models/User');
const Inspection = require('../models/Inspection');
const Document = require('../models/Document');
const ProjectAvaluatorAssignment = require('../models/ProjectAvaluatorAssignment');
const { requireProjectAccess } = require('../middleware/rbac');
const { REQUIREMENT_TITLES, PROMOTER_EXPERIENCE_FIELDS, normalizePhaseRequirements } = require('../services/phaseRequirements');
const {
  financeApprovedTotals,
  buildFinanceControlSummary: sharedBuildFinanceControlSummary,
  buildFinanceControlAlerts: sharedBuildFinanceControlAlerts
} = require('../services/financeReportContext');
const { sanitizePromoterProfile } = require('../utils/promoterProfile');
const { verifyPassword } = require('../utils/passwords');
const audit = require('../utils/audit');
const { renderInspectionReport } = require('../services/inspectionReport');
const inspectionReportContext = require('../services/inspectionReportContext');

router.use(bankReadOnly);
router.use('/projects/:projectId/finance', requireProjectAccess({ commercialOnlySales: false }));

const fs   = require('fs');
const path = require('path');
const axios = require('axios');

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { formatProjectMoney } = require('../utils/currency');

/* =========================================================================
   Helpers base
   ========================================================================= */

function getTenantKey(req) {
  return req.tenantKey || req.user?.tenantKey || req.tenant?.tenantKey || req.tenant?.key || null;
}

async function loadTenantProject(req, res) {
  const { projectId } = req.params;
  if (!mongoose.isValidObjectId(projectId)) {
    res.status(400).json({ error: 'projectId inválido' });
    return null;
  }

  const tenantKey = getTenantKey(req);
  if (!tenantKey) {
    res.status(403).json({ error: 'Falta tenantKey' });
    return null;
  }

  const project = await Project.findOne({ _id: projectId, tenantKey });
  if (!project) {
    res.status(404).json({ error: 'Proyecto no encontrado' });
    return null;
  }

  return project;
}

async function getOrCreate(projectId, tenantKey) {
  let doc = await ProjectFinance.findOne({ project: projectId, tenantKey });
  if (!doc) {
    doc = await ProjectFinance.findOne({
      project: projectId,
      $or: [
        { tenantKey: { $exists: false } },
        { tenantKey: null },
        { tenantKey: '' }
      ]
    });
    if (doc) {
      doc.tenantKey = tenantKey;
      await doc.save();
    }
  }
  if (!doc) {
    doc = await ProjectFinance.create({ tenantKey, project: projectId, phases: [] });
  }
  return doc;
}

async function ensureFinanceRequirements(doc, project, commercialUnits = []) {
  const projectPlain = project?.toObject ? project.toObject() : (project || {});
  const promoterId = projectPlain.assignedPromoters?.[0];
  const promoter = promoterId
    ? await User.findById(promoterId).select('promoterProfile').lean()
    : null;
  let changed = false;

  for (const phase of (doc.phases || [])) {
    const current = Array.isArray(phase.requirements) ? phase.requirements : [];
    const normalized = normalizePhaseRequirements(current, {
      project: projectPlain,
      promoterProfile: promoter?.promoterProfile || {},
      phase: phase.toObject ? phase.toObject() : phase,
      commercialUnits
    });
    const needsNormalization = current.length !== REQUIREMENT_TITLES.length || current.some((item, index) => (
      Number(item?.number) !== index + 1 || String(item?.title || '') !== REQUIREMENT_TITLES[index]
      || String(item?.information || '') !== String(normalized[index]?.information || '')
      || String(item?.manualInformation || '') !== String(normalized[index]?.manualInformation || '')
      || JSON.stringify(item?.structuredData || null) !== JSON.stringify(normalized[index]?.structuredData || null)
      || String(item?.sourceKey || '') !== String(normalized[index]?.sourceKey || '')
      || String(item?.sourceLabel || '') !== String(normalized[index]?.sourceLabel || '')
    ));
    if (!needsNormalization) continue;
    phase.requirements = normalized;
    changed = true;
  }

  if (changed) await doc.save();
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

const moneyES = (n, currency = 'PAB') => formatProjectMoney(n, currency);

const cleanDate = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
};

function normalizeLoanEntry(raw = {}) {
  const entryType = ['disbursement', 'manual_amortization'].includes(raw.entryType) ? raw.entryType : 'legacy';
  const paymentStatus = entryType === 'disbursement'
    ? (raw.paymentStatus === 'pending' ? 'pending' : 'paid')
    : 'legacy';
  const workflowStatus = entryType === 'disbursement'
    ? (paymentStatus === 'paid'
        ? 'disbursed'
        : ['prepared', 'requested', 'returned', 'disbursed'].includes(raw.workflowStatus)
        ? raw.workflowStatus
        : 'prepared')
    : 'prepared';
  return {
    _id: mongoose.isValidObjectId(raw._id) ? raw._id : undefined,
    entryType,
    paymentStatus,
    workflowStatus,
    advanceAccountNumber: Number.isInteger(Number(raw.advanceAccountNumber)) && Number(raw.advanceAccountNumber) > 0 ? Number(raw.advanceAccountNumber) : null,
    fundingParty: ['bank', 'promoter', 'mixed'].includes(raw.fundingParty) ? raw.fundingParty : 'bank',
    promoterContributionAmount: Math.max(0, toNum(raw.promoterContributionAmount)),
    promoterContributionStatus: raw.promoterContributionStatus === 'contributed' ? 'contributed' : 'pending',
    promoterContributedAt: cleanDate(raw.promoterContributedAt),
    promoterContributedBy: mongoose.isValidObjectId(raw.promoterContributedBy) ? raw.promoterContributedBy : null,
    promoterContributedByRole: String(raw.promoterContributedByRole || '').trim(),
    requestedAt: cleanDate(raw.requestedAt),
    requestedBy: mongoose.isValidObjectId(raw.requestedBy) ? raw.requestedBy : null,
    requestedByRole: String(raw.requestedByRole || '').trim(),
    requestDocumentId: mongoose.isValidObjectId(raw.requestDocumentId) ? raw.requestDocumentId : null,
    requestDocumentName: String(raw.requestDocumentName || '').trim().slice(0, 240),
    requirementsSnapshot: Array.isArray(raw.requirementsSnapshot) ? raw.requirementsSnapshot : [],
    requirementsConfirmedAt: cleanDate(raw.requirementsConfirmedAt),
    requirementsConfirmedBy: mongoose.isValidObjectId(raw.requirementsConfirmedBy) ? raw.requirementsConfirmedBy : null,
    requirementsConfirmedByRole: String(raw.requirementsConfirmedByRole || '').trim(),
    returnedAt: cleanDate(raw.returnedAt),
    returnedBy: mongoose.isValidObjectId(raw.returnedBy) ? raw.returnedBy : null,
    returnedByRole: String(raw.returnedByRole || '').trim(),
    returnComment: String(raw.returnComment || '').trim().slice(0, 500),
    returnAlertAcknowledgedAt: cleanDate(raw.returnAlertAcknowledgedAt),
    returnAlertAcknowledgedBy: mongoose.isValidObjectId(raw.returnAlertAcknowledgedBy) ? raw.returnAlertAcknowledgedBy : null,
    returnAlertAcknowledgedByRole: String(raw.returnAlertAcknowledgedByRole || '').trim(),
    disbursedAt: cleanDate(raw.disbursedAt),
    disbursedBy: mongoose.isValidObjectId(raw.disbursedBy) ? raw.disbursedBy : null,
    disbursedByRole: String(raw.disbursedByRole || '').trim(),
    transferReference: String(raw.transferReference || '').trim().slice(0, 120),
    workflowNote: String(raw.workflowNote || '').trim().slice(0, 500),
    movementDate: cleanDate(raw.movementDate),
    disbursementDate: cleanDate(raw.disbursementDate),
    loanNumber: String(raw.loanNumber || '').trim(),
    disbursementAmount: toNum(raw.disbursementAmount),
    maturityDate: cleanDate(raw.maturityDate),
    amortizedAmount: toNum(raw.amortizedAmount),
    inspectionId: mongoose.isValidObjectId(raw.inspectionId) ? raw.inspectionId : null,
    notes: String(raw.notes || '').trim(),
  };
}

function loanEntryWorkflowStatus(entry = {}) {
  if (entry?.entryType !== 'disbursement') return '';
  if (entry?.paymentStatus === 'paid') return 'disbursed';
  if (['prepared', 'requested', 'returned', 'disbursed'].includes(String(entry.workflowStatus || ''))) {
    return String(entry.workflowStatus);
  }
  return entry?.paymentStatus === 'paid' ? 'disbursed' : 'prepared';
}

function mergeProtectedLoanWorkflow(rawLines = [], currentDoc) {
  const merged = rawLines.map(line => ({ ...line, entries: Array.isArray(line?.entries) ? line.entries.map(entry => ({ ...entry })) : [] }));
  const rawLinesById = new Map(merged.filter(line => mongoose.isValidObjectId(line?._id)).map(line => [String(line._id), line]));
  const protectedFields = [
    'paymentStatus', 'workflowStatus', 'advanceAccountNumber',
    'promoterContributionStatus', 'promoterContributedAt', 'promoterContributedBy', 'promoterContributedByRole',
    'requestedAt', 'requestedBy', 'requestedByRole', 'requestDocumentId', 'requestDocumentName',
    'requirementsSnapshot', 'requirementsConfirmedAt', 'requirementsConfirmedBy', 'requirementsConfirmedByRole',
    'returnedAt', 'returnedBy', 'returnedByRole', 'returnComment',
    'returnAlertAcknowledgedAt', 'returnAlertAcknowledgedBy', 'returnAlertAcknowledgedByRole',
    'disbursedAt', 'disbursedBy', 'disbursedByRole', 'transferReference', 'workflowNote'
  ];

  for (const currentLine of (currentDoc?.loanLines || [])) {
    const rawLine = rawLinesById.get(String(currentLine?._id || ''));
    for (const currentEntry of (currentLine?.entries || [])) {
      if (currentEntry?.entryType !== 'disbursement') continue;
      const status = loanEntryWorkflowStatus(currentEntry);
      const contributionLocked = currentEntry?.promoterContributionStatus === 'contributed';
      const rawEntry = rawLine?.entries?.find(entry => String(entry?._id || '') === String(currentEntry?._id || ''));
      if (!rawEntry && (['requested', 'returned', 'disbursed'].includes(status) || contributionLocked)) {
        throw Object.assign(new Error('Una cuenta solicitada, aportada o desembolsada no se puede eliminar.'), { status: 409 });
      }
      if (!rawEntry) continue;
      if (['requested', 'disbursed'].includes(status) || contributionLocked) {
        const saved = currentEntry.toObject ? currentEntry.toObject() : currentEntry;
        Object.assign(rawEntry, saved, { _id: currentEntry._id });
      } else {
        protectedFields.forEach(field => { rawEntry[field] = currentEntry[field] ?? null; });
      }
    }
  }

  for (const line of merged) {
    for (const entry of (line.entries || [])) {
      if (entry?.entryType !== 'disbursement' || mongoose.isValidObjectId(entry?._id)) continue;
      Object.assign(entry, {
        paymentStatus: 'pending', workflowStatus: 'prepared', requestedAt: null, requestedBy: null,
        requestedByRole: '', disbursedAt: null, disbursedBy: null, disbursedByRole: '',
        advanceAccountNumber: null, promoterContributionStatus: 'pending', promoterContributedAt: null,
        promoterContributedBy: null, promoterContributedByRole: '', requestDocumentId: null,
        requestDocumentName: '', requirementsSnapshot: [], requirementsConfirmedAt: null,
        requirementsConfirmedBy: null, requirementsConfirmedByRole: '', returnedAt: null,
        returnedBy: null, returnedByRole: '', returnComment: '', returnAlertAcknowledgedAt: null,
        returnAlertAcknowledgedBy: null, returnAlertAcknowledgedByRole: '', transferReference: '', workflowNote: ''
      });
    }
  }
  return merged;
}

function assignAdvanceAccountNumbers(lines = [], currentDoc) {
  const currentById = new Map();
  let next = 0;
  for (const line of (currentDoc?.loanLines || [])) {
    for (const entry of (line?.entries || [])) {
      const number = Number(entry?.advanceAccountNumber || 0);
      if (entry?._id && number > 0) currentById.set(String(entry._id), number);
      next = Math.max(next, number);
    }
  }
  for (const line of lines) {
    for (const entry of (line?.entries || [])) {
      if (entry?.entryType !== 'disbursement') continue;
      const savedNumber = entry?._id ? currentById.get(String(entry._id)) : null;
      if (savedNumber) entry.advanceAccountNumber = savedNumber;
      else entry.advanceAccountNumber = ++next;
    }
  }
  return lines;
}

function snapshotPhaseRequirements(phase) {
  return (phase?.requirements || []).map((item, index) => {
    const raw = item?.toObject ? item.toObject() : item;
    const validity = String(raw?.structuredData?.validityStatus || '').toUpperCase();
    const compliant = String(raw?.status || '').toUpperCase() === 'CUMPLIDO' && !['EXPIRED', 'MISSING'].includes(validity);
    return {
      requirementId: raw?._id ? String(raw._id) : '',
      legacyRequirementIds: Array.isArray(raw?.legacyRequirementIds) ? raw.legacyRequirementIds.map(String) : [],
      number: Number(raw?.number || index + 1),
      title: String(raw?.title || `Requisito ${index + 1}`).trim(),
      status: String(raw?.status || 'PENDIENTE').toUpperCase(),
      reviewStatus: compliant ? 'compliant' : (validity === 'EXPIRED' ? 'expired' : 'pending'),
      information: String(raw?.information || '').trim().slice(0, 2000),
      manualInformation: String(raw?.manualInformation || '').trim().slice(0, 2000),
      sourceLabel: String(raw?.sourceLabel || '').trim().slice(0, 160),
      observations: String(raw?.observations || '').trim().slice(0, 500),
      structuredData: raw?.structuredData || {},
      capturedAt: new Date()
    };
  });
}

function validateLoanFunding(lines = []) {
  for (const line of lines) {
    for (const entry of (line?.entries || [])) {
      if (entry?.entryType !== 'disbursement') continue;
      const party = ['bank', 'promoter', 'mixed'].includes(entry.fundingParty) ? entry.fundingParty : 'bank';
      const bankAmount = party === 'promoter' ? 0 : Math.max(0, toNum(entry.disbursementAmount));
      const promoterAmount = party === 'mixed' ? Math.max(0, toNum(entry.promoterContributionAmount)) : 0;
      if (party !== 'mixed') entry.promoterContributionAmount = 0;
      if (party === 'bank' && promoterAmount > 0) throw Object.assign(new Error('Una cuenta financiada solo por el banco no puede incluir aporte del promotor. Selecciona “Banco + promotor”.'), { status: 400 });
      if (party === 'promoter' && bankAmount > 0) throw Object.assign(new Error('Una cuenta financiada solo por el promotor no puede incluir importe del banco.'), { status: 400 });
      if (party === 'mixed' && (!bankAmount || !promoterAmount)) throw Object.assign(new Error('Una cuenta mixta debe indicar tanto el importe del banco como el aporte del promotor.'), { status: 400 });
    }
  }
}

function normalizeLoanLine(raw = {}, idx = 0) {
  const entries = Array.isArray(raw.entries) && raw.entries.length
    ? raw.entries.map(normalizeLoanEntry)
    : [normalizeLoanEntry(raw)].filter(e =>
        e.disbursementDate || e.loanNumber || e.disbursementAmount || e.maturityDate || e.amortizedAmount || e.notes
      );
  return {
    _id: mongoose.isValidObjectId(raw._id) ? raw._id : undefined,
    phaseId: mongoose.isValidObjectId(raw.phaseId) ? raw.phaseId : null,
    phaseName: String(raw.phaseName || '').trim(),
    sourceUseId: mongoose.isValidObjectId(raw.sourceUseId) ? raw.sourceUseId : null,
    approvedAmountMode: raw.approvedAmountMode === 'auto' ? 'auto' : 'manual',
    name: String(raw.name || `Linea ${idx + 1}`).trim(),
    approvedAmount: Math.max(0, toNum(raw.approvedAmount)),
    financierTenantKey: String(raw.financierTenantKey || '').trim(),
    financierName: String(raw.financierName || raw.bankName || '').trim(),
    financierType: String(raw.financierType || 'bank').trim(),
    concept: String(raw.concept || '').trim(),
    entries,
    notes: String(raw.notes || '').trim(),
  };
}

function normalizedFinanceName(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/\b(de|del|la|el|los|las)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function loanLineEffectiveDisbursed(line = {}) {
  const entries = Array.isArray(line.entries) && line.entries.length ? line.entries : [line];
  return entries.reduce((sum, entry) => {
    if (entry?.entryType === 'disbursement' && entry?.paymentStatus === 'pending') return sum;
    return sum + Math.max(0, toNum(entry?.disbursementAmount));
  }, 0);
}

function loanLineHasMovements(line = {}) {
  return (line.entries || []).some(entry => (
    entry?.disbursementDate || entry?.movementDate || entry?.loanNumber || entry?.maturityDate ||
    entry?.inspectionId || toNum(entry?.disbursementAmount) || toNum(entry?.amortizedAmount) || String(entry?.notes || '').trim()
  )) || toNum(line.disbursementAmount) || toNum(line.amortizedAmount);
}

function phaseBankApproved(phase = {}) {
  const bankSources = (phase.planSources || []).filter(item => /banco|financiacion bancaria|prestamo/.test(normalizedFinanceName(item?.name)));
  return bankSources.length
    ? bankSources.reduce((sum, item) => sum + Math.max(0, toNum(item?.amount)), 0)
    : Math.max(0, toNum(phase?.financialConditions?.bankFinancedAmount));
}

function syncLoanLinesFromPhaseUses(doc, phase, { createAll = false, createForUseIds = new Set() } = {}) {
  const phaseId = String(phase?._id || '');
  if (!phaseId) return;
  const uses = Array.from(phase.planUses || []).filter(use => String(use?.name || '').trim() || toNum(use?.amount));
  const isFirstPhase = String(doc.phases?.[0]?._id || '') === phaseId;
  const phaseLines = Array.from(doc.loanLines || []).filter(line => String(line?.phaseId || '') === phaseId || (isFirstPhase && !line?.phaseId));
  const claimedLineIds = new Set();

  for (const use of uses) {
    const useId = String(use?._id || '');
    let line = phaseLines.find(item => String(item?.sourceUseId || '') === useId);
    if (!line) {
      line = phaseLines.find(item => (
        !claimedLineIds.has(String(item?._id || '')) &&
        !item?.sourceUseId &&
        normalizedFinanceName(item?.name) === normalizedFinanceName(use?.name) &&
        !toNum(item?.approvedAmount)
      ));
      if (line) {
        line.sourceUseId = use._id;
        line.approvedAmountMode = 'auto';
      }
    }
    if (!line && (createAll || createForUseIds.has(useId))) {
      doc.loanLines.push({
        phaseId: phase._id,
        phaseName: phase.name || '',
        sourceUseId: use._id,
        approvedAmountMode: 'auto',
        name: String(use?.name || 'Nueva línea').trim(),
        approvedAmount: 0,
        entries: []
      });
      line = doc.loanLines[doc.loanLines.length - 1];
      phaseLines.push(line);
    }
    if (!line) continue;
    claimedLineIds.add(String(line._id || ''));
    line.phaseId = phase._id;
    line.phaseName = phase.name || '';
    if (line.approvedAmountMode === 'auto') line.name = String(use?.name || line.name || 'Línea').trim();
  }

  const activeUseIds = new Set(uses.map(use => String(use?._id || '')));
  const allocatedLineIds = new Set((doc.unitAmortizations || []).flatMap(item => (item.allocations || []).map(allocation => String(allocation?.loanLineId || ''))));
  doc.loanLines = (doc.loanLines || []).filter(line => {
    if (String(line?.phaseId || '') !== phaseId || line.approvedAmountMode !== 'auto' || !line.sourceUseId) return true;
    if (activeUseIds.has(String(line.sourceUseId))) return true;
    if (loanLineHasMovements(line) || allocatedLineIds.has(String(line._id || ''))) {
      line.sourceUseId = null;
      line.approvedAmountMode = 'manual';
      return true;
    }
    return false;
  });

  const updatedPhaseLines = Array.from(doc.loanLines || []).filter(line => String(line?.phaseId || '') === phaseId);
  const autoLines = updatedPhaseLines.filter(line => line.approvedAmountMode === 'auto' && line.sourceUseId);
  if (!autoLines.length) return;
  const manualApproved = updatedPhaseLines
    .filter(line => !autoLines.includes(line))
    .reduce((sum, line) => sum + Math.max(0, toNum(line?.approvedAmount)), 0);
  const available = Math.max(0, phaseBankApproved(phase) - manualApproved);
  const useById = new Map(uses.map(use => [String(use?._id || ''), use]));
  const totalUse = autoLines.reduce((sum, line) => sum + Math.max(0, toNum(useById.get(String(line.sourceUseId))?.amount)), 0);
  const floors = autoLines.map(line => loanLineEffectiveDisbursed(line));
  const floorTotal = floors.reduce((sum, amount) => sum + amount, 0);
  let remaining = Math.max(0, available - floorTotal);
  const desired = autoLines.map(line => totalUse > 0
    ? available * Math.max(0, toNum(useById.get(String(line.sourceUseId))?.amount)) / totalUse
    : available / autoLines.length);
  const gaps = desired.map((amount, index) => Math.max(0, amount - floors[index]));
  const gapTotal = gaps.reduce((sum, amount) => sum + amount, 0);
  const allocations = floors.slice();
  if (remaining > 0 && gapTotal > 0) {
    const used = Math.min(remaining, gapTotal);
    gaps.forEach((gap, index) => { allocations[index] += used * gap / gapTotal; });
    remaining -= used;
  }
  if (remaining > 0) {
    autoLines.forEach((line, index) => {
      const weight = totalUse > 0
        ? Math.max(0, toNum(useById.get(String(line.sourceUseId))?.amount)) / totalUse
        : 1 / autoLines.length;
      allocations[index] += remaining * weight;
    });
  }
  autoLines.forEach((line, index) => { line.approvedAmount = Math.round(allocations[index] * 100) / 100; });
}

function activeAvaluatorAssignmentFilter(req, project) {
  const filter = { projectId: project._id, projectTenantKey: project.tenantKey, status: 'active' };
  if (req.user?.role === 'bank') filter.bankTenantKey = getTenantKey(req);
  return filter;
}

function validateLoanLineLimits(doc, rawLines = []) {
  for (const phase of (doc.phases || [])) {
    const phaseId = String(phase._id || '');
    const approvedForPhase = rawLines
      .filter(line => String(line?.phaseId || '') === phaseId)
      .reduce((sum, line) => sum + Math.max(0, toNum(line?.approvedAmount)), 0);
    let hasBankSource = false;
    const bankSource = (phase.planSources || []).reduce((sum, item) => {
      const name = String(item?.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
      if (!/banco|financiacion bancaria|prestamo/.test(name)) return sum;
      hasBankSource = true;
      return sum + toNum(item?.amount);
    }, 0);
    const bankApproved = hasBankSource ? bankSource : toNum(phase?.financialConditions?.bankFinancedAmount);
    if ((hasBankSource || bankApproved > 0) && approvedForPhase > bankApproved + 0.01) {
      throw Object.assign(new Error(`Las líneas de ${phase.name || 'la fase'} superan el importe aprobado por el banco.`), { status: 400 });
    }
  }
}

async function validateLoanLineReports({ req, project, rawLines, currentDoc }) {
  const assignments = await ProjectAvaluatorAssignment.find(activeAvaluatorAssignmentFilter(req, project)).select('_id bankTenantKey').lean();
  for (const line of rawLines) {
    for (const entry of (Array.isArray(line?.entries) ? line.entries : [])) {
      if (entry?.entryType === 'disbursement' && entry?.paymentStatus === 'paid' && !cleanDate(entry.disbursementDate)) {
        throw Object.assign(new Error('Indica la fecha de transferencia de cada desembolso pagado.'), { status: 400 });
      }
    }
  }
  if (!assignments.length) return null;

  const previousEntries = new Map();
  for (const line of (currentDoc.loanLines || [])) {
    for (const entry of (line.entries || [])) previousEntries.set(String(entry._id), entry);
  }

  const reportIds = [];
  for (const line of rawLines) {
    for (const entry of (Array.isArray(line?.entries) ? line.entries : [])) {
      const type = String(entry?.entryType || 'legacy');
      if (type !== 'disbursement') continue;
      const previous = mongoose.isValidObjectId(entry?._id) ? previousEntries.get(String(entry._id)) : null;
      const isHistorical = previous && String(previous.entryType || 'legacy') === 'legacy' && !previous.inspectionId;
      if (previous?.inspectionId && String(previous.inspectionId) !== String(entry.inspectionId || '')) {
        throw Object.assign(new Error('El informe vinculado a un desembolso guardado no se puede sustituir.'), { status: 409 });
      }
      if (!entry.inspectionId && !isHistorical) {
        throw Object.assign(new Error('Selecciona un informe finalizado del avaluador para cada desembolso.'), { status: 400 });
      }
      if (entry.inspectionId) reportIds.push(String(entry.inspectionId));
    }
  }
  if (new Set(reportIds).size !== reportIds.length) {
    throw Object.assign(new Error('Un informe de avalúo solo puede justificar un desembolso.'), { status: 409 });
  }
  if (!reportIds.length) return;
  const reports = await Inspection.find({
    _id: { $in: reportIds },
    projectId: project._id,
    projectTenantKey: project.tenantKey,
    status: 'finalized',
    bankTenantKey: { $in: assignments.map(item => item.bankTenantKey) }
  }).select('_id sequence').lean();
  if (reports.length !== reportIds.length) {
    throw Object.assign(new Error('Alguno de los informes seleccionados no es válido para este proyecto.'), { status: 400 });
  }
  const reportById = new Map(reports.map(report => [String(report._id), report]));
  for (const line of rawLines) {
    for (const entry of (Array.isArray(line?.entries) ? line.entries : [])) {
      const report = reportById.get(String(entry?.inspectionId || ''));
      if (report) entry.advanceAccountNumber = Number(report.sequence);
    }
  }
}

async function validateWorkflowReport({ project, entry }) {
  const assignments = await ProjectAvaluatorAssignment.find({
    projectId: project._id,
    projectTenantKey: project.tenantKey,
    status: 'active'
  }).select('_id bankTenantKey').lean();
  if (!assignments.length) return;
  if (!entry?.inspectionId) {
    throw Object.assign(new Error('Este desembolso necesita un informe finalizado del avaluador.'), { status: 400 });
  }
  const report = await Inspection.findOne({
    _id: entry.inspectionId,
    projectId: project._id,
    projectTenantKey: project.tenantKey,
    status: 'finalized',
    bankTenantKey: { $in: assignments.map(item => item.bankTenantKey) }
  }).select('_id sequence').lean();
  if (!report) {
    throw Object.assign(new Error('El informe de avalúo vinculado no es válido para este proyecto.'), { status: 400 });
  }
  return report;
}

function normalizePhaseFinancialConditions(raw = {}) {
  const cleanDateValue = cleanDate(raw.letterDate);
  return {
    interimBank: String(raw.interimBank || '').trim(),
    letterDate: cleanDateValue,
    letterReference: String(raw.letterReference || '').trim(),
    phaseTotal: toNum(raw.phaseTotal),
    bankFinancedAmount: toNum(raw.bankFinancedAmount),
    bankFinancedPct: toNum(raw.bankFinancedPct),
    promoterContribution: toNum(raw.promoterContribution),
    promoterContributionPct: toNum(raw.promoterContributionPct),
    generalConditions: String(raw.generalConditions || '').trim(),
    guarantees: String(raw.guarantees || '').trim(),
    insurance: String(raw.insurance || '').trim(),
    requiredPresales: String(raw.requiredPresales || '').trim(),
    precedentConditions: String(raw.precedentConditions || '').trim(),
    otherRequirements: String(raw.otherRequirements || '').trim(),
    disbursementConditions: String(raw.disbursementConditions || '').trim(),
    amortizationConditions: String(raw.amortizationConditions || '').trim(),
    promoterObligations: String(raw.promoterObligations || '').trim(),
    covenants: String(raw.covenants || '').trim(),
    trustee: String(raw.trustee || '').trim(),
    trustType: String(raw.trustType || '').trim(),
    technicalInspector: String(raw.technicalInspector || '').trim(),
    financialInspector: String(raw.financialInspector || '').trim(),
    generalObservations: String(raw.generalObservations || '').trim(),
  };
}

function normalizePhaseFinancingLines(raw = []) {
  return (Array.isArray(raw) ? raw : []).slice(0, 50).map(item => ({
    _id: mongoose.isValidObjectId(item?._id) ? item._id : undefined,
    name: String(item?.name || item?.facility || '').trim(),
    financierTenantKey: String(item?.financierTenantKey || '').trim(),
    financierName: String(item?.financierName || item?.bankName || '').trim(),
    financierType: String(item?.financierType || 'bank').trim(),
    concept: String(item?.concept || '').trim(),
    approvedAmount: toNum(item?.approvedAmount ?? item?.amount),
    disbursedAmount: toNum(item?.disbursedAmount),
    amortizedAmount: toNum(item?.amortizedAmount),
    outstandingBalance: toNum(item?.outstandingBalance),
    interestRate: String(item?.interestRate || '').trim(),
    term: String(item?.term || '').trim(),
    paymentMethod: String(item?.paymentMethod || '').trim(),
    disbursementMethod: String(item?.disbursementMethod || '').trim(),
    commission: String(item?.commission || '').trim(),
    observations: String(item?.observations || item?.notes || '').trim(),
  })).filter(item => Object.values(item).some(value => String(value ?? '').trim() !== '' && toNum(value) !== 0));
}

function normalizeUnitAmortization(raw = {}) {
  const unitId = mongoose.isValidObjectId(raw.unitId) ? raw.unitId : null;
  const allocations = Array.isArray(raw.allocations) ? raw.allocations.map(a => ({
    loanLineId: mongoose.isValidObjectId(a.loanLineId) ? a.loanLineId : null,
    loanLineName: String(a.loanLineName || '').trim(),
    amount: toNum(a.amount),
  })).filter(a => a.loanLineId || a.loanLineName || a.amount) : [];
  return {
    _id: mongoose.isValidObjectId(raw._id) ? raw._id : undefined,
    unitId,
    clientName: String(raw.clientName || '').trim(),
    lot: String(raw.lot || '').trim(),
    buyerBank: String(raw.buyerBank || '').trim(),
    checkNumber: String(raw.checkNumber || '').trim(),
    checkDate: cleanDate(raw.checkDate),
    checkAmount: toNum(raw.checkAmount),
    checkAmountSource: String(raw.checkAmountSource || 'cpp').trim(),
    amortizationLine1: toNum(raw.amortizationLine1),
    amortizationLine2: toNum(raw.amortizationLine2),
    allocations,
    promoterAmount: toNum(raw.promoterAmount),
    notes: String(raw.notes || '').trim(),
  };
}

function commercialClientName(v = {}) {
  const full = [
    v.primerNombre,
    v.segundoNombre,
    v.primerApellido,
    v.segundoApellido,
    v.apellidoCasada
  ].filter(Boolean).join(' ').trim();
  return full || v.clienteNombre || '';
}

async function getFinanceCommercialUnits(projectId, tenantKey) {
  const unitFilter = { projectId, deletedAt: null };
  const ventaFilter = { projectId };
  if (tenantKey) {
    unitFilter.tenantKey = tenantKey;
    ventaFilter.tenantKey = tenantKey;
  }

  const [units, ventas] = await Promise.all([
    Unit.find(unitFilter).select('_id manzana lote estado precioLista modelo recamaras banos areaAbierta areaCerrada').sort({ manzana: 1, lote: 1 }).lean(),
    Venta.find(ventaFilter).select('unitId clienteNombre primerNombre segundoNombre primerApellido segundoApellido apellidoCasada banco valor montoFinanciamientoCPP precioVenta abonoInicial abonoCliente numCPP estatusCPP statusBanco').lean()
  ]);

  const ventasByUnit = new Map((ventas || []).map(v => [String(v.unitId), v]));
  return (units || []).map(u => {
    const venta = ventasByUnit.get(String(u._id)) || {};
    return {
      unitId: String(u._id),
      lot: [u.manzana, u.lote].filter(Boolean).join('-') || u.lote || u.manzana || '',
      unitLabel: [u.manzana, u.lote].filter(Boolean).join('-') || u.modelo || 'Unidad',
      modelName: u.modelo || '',
      bedrooms: toNum(u.recamaras),
      bathrooms: toNum(u.banos),
      openAreaM2: toNum(u.areaAbierta),
      closedAreaM2: toNum(u.areaCerrada),
      commercialStatus: u.estado || '',
      clientName: commercialClientName(venta),
      buyerBank: venta.banco || '',
      cppAmount: toNum(venta.montoFinanciamientoCPP || venta.valor),
      initialPayment: toNum(venta.abonoInicial || venta.abonoCliente),
      salePrice: toNum(venta.precioVenta || u.precioLista),
      financeBaseAmount: toNum(venta.montoFinanciamientoCPP || venta.valor),
      financeBaseAmountWithInitial: toNum(venta.montoFinanciamientoCPP || venta.valor) + toNum(venta.abonoInicial || venta.abonoCliente),
      cppNumber: venta.numCPP || '',
      cppStatus: venta.estatusCPP || venta.statusBanco || '',
    };
  });
}

function normalizeFinancierBanks(raw = []) {
  return [...new Set((Array.isArray(raw) ? raw : []).map(value => String(value || '').trim()).filter(Boolean))].slice(0, 20);
}

function isFinanceSoldLikeStatus(status) {
  return ['reservado', 'con_cpp', 'tramite_legal_activado', 'escriturado_traspasado', 'vivienda_entregada']
    .includes(String(status || '').toLowerCase());
}

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

    const p = await loadTenantProject(req, res);
    if (!p) return;

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

    const projectRaw = await loadTenantProject(req, res);
    if (!projectRaw) return;

    const doc = await getOrCreate(projectId, projectRaw.tenantKey);
    const commercialUnits = await getFinanceCommercialUnits(projectId, projectRaw.tenantKey);
    await ensureFinanceRequirements(doc, projectRaw, commercialUnits);

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
    const projectPlain = projectRaw?.toObject ? projectRaw.toObject() : projectRaw;
    const approvedTotals = financeApprovedTotals(doc, projectPlain || {});
    const commercialUnitsTotal = commercialUnits.length;
    const commercialUnitsSold = commercialUnits.filter(unit => isFinanceSoldLikeStatus(unit.commercialStatus)).length;
    const project = projectPlain ? {
      ...projectPlain,
      loanApproved: approvedTotals.loanApproved,
      budgetApproved: approvedTotals.budgetApproved,
      unitsTotal: toNum(projectPlain.unitsTotal) || commercialUnitsTotal,
      unitsSold: toNum(projectPlain.unitsSold) || commercialUnitsSold,
      financialConditions: {
        ...(projectPlain.financialConditions || {}),
        projectTotal: approvedTotals.budgetApproved,
        bankFinancedAmount: approvedTotals.loanApproved,
        promoterContribution: approvedTotals.promoterContribution
      }
    } : null;
    const financeControl = sharedBuildFinanceControlSummary(doc, project || {});
    const financeControlAlerts = sharedBuildFinanceControlAlerts(financeControl, commercialUnits);

    res.json({
      finance: doc,
      kpis,
      alerts: [...alerts, ...financeControlAlerts],
      project,
      commercialUnits,
      financeControl
    });
  } catch (err) {
    console.error('GET finance error', err);
    res.status(500).json({ error: 'Error al obtener finanzas' });
  }
});

router.put('/projects/:projectId/finance/promoter-experience', async (req, res) => {
  try {
    const project = await loadTenantProject(req, res);
    if (!project) return;
    const promoterId = project.assignedPromoters?.[0];
    if (!promoterId) return res.status(400).json({ error: 'El proyecto no tiene un promotor asignado.' });
    const promoter = await User.findOne({ _id: promoterId, $or: [{ tenantKey: project.tenantKey }, { tenantKeys: project.tenantKey }] });
    if (!promoter) return res.status(404).json({ error: 'Promotor no encontrado.' });
    const values = req.body?.values || {};
    const base = req.body?.base || {};
    const current = promoter.promoterProfile?.toObject ? promoter.promoterProfile.toObject() : (promoter.promoterProfile || {});
    const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
    const conflicts = PROMOTER_EXPERIENCE_FIELDS.filter(key => key in values && key in base && !same(current[key], base[key]));
    if (conflicts.length) return res.status(409).json({ error: 'El perfil cambió desde que se abrió el requisito. Recarga antes de guardar para no sobrescribir información reciente.', conflicts });
    const merged = { ...current };
    PROMOTER_EXPERIENCE_FIELDS.forEach(key => { if (key in values) merged[key] = values[key]; });
    promoter.promoterProfile = sanitizePromoterProfile(merged, { strictNumbers: true });
    await promoter.save();
    await audit(req, 'finance.requirement_promoter_experience_updated', { targetType: 'user', targetId: promoter._id, projectId: project._id, message: 'Experiencia del promotor actualizada desde Requisitos' });
    res.json({ ok: true, promoterProfile: promoter.promoterProfile, promoterCategory: promoter.promoterCategory });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'No se pudo actualizar la experiencia del promotor.' });
  }
});

router.put('/projects/:projectId/finance/legal-parties', async (req, res) => {
  try {
    const project = await loadTenantProject(req, res);
    if (!project) return;
    const values = req.body?.values || {};
    const base = req.body?.base || {};
    const current = project.legalData?.toObject ? project.legalData.toObject() : (project.legalData || {});
    const same = (a, b) => JSON.stringify(a || []) === JSON.stringify(b || []);
    const conflicts = [];
    if (Array.isArray(values.shareholders) && Array.isArray(base.shareholders) && !same(current.shareholders, base.shareholders)) conflicts.push('shareholders');
    if (Array.isArray(values.dignitaries) && Array.isArray(base.dignitaries) && !same(current.boardMembers, base.dignitaries)) conflicts.push('dignitaries');
    if (conflicts.length) return res.status(409).json({ error: 'Los datos legales cambiaron desde que se abrió el requisito. Recarga antes de guardar para no sobrescribir información reciente.', conflicts });
    const cleanShareholders = rows => (rows || []).slice(0, 50).map(item => ({ name: String(item?.name || '').trim(), cedula: String(item?.cedula || '').trim(), percentage: Math.max(0, Number(item?.percentage || 0)) })).filter(item => item.name || item.cedula || item.percentage);
    const cleanDignitaries = rows => (rows || []).slice(0, 50).map(item => ({ name: String(item?.name || '').trim(), cedula: String(item?.cedula || '').trim(), position: String(item?.position || '').trim() })).filter(item => item.name || item.cedula || item.position);
    if (Array.isArray(values.shareholders)) project.legalData.shareholders = cleanShareholders(values.shareholders);
    if (Array.isArray(values.dignitaries)) project.legalData.boardMembers = cleanDignitaries(values.dignitaries);
    await project.save();
    await audit(req, 'finance.requirement_legal_parties_updated', { targetType: 'project', targetId: project._id, projectId: project._id, message: 'Accionistas y dignatarios actualizados desde Requisitos' });
    res.json({ ok: true, legalData: project.legalData });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'No se pudieron actualizar los datos legales.' });
  }
});

router.put('/projects/:projectId/finance/loan-lines', async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!mongoose.isValidObjectId(projectId)) {
      return res.status(400).json({ error: 'projectId invalido' });
    }

    const project = await loadTenantProject(req, res);
    if (!project) return;

    const doc = await getOrCreate(projectId, project.tenantKey);
    const rawLines = Array.isArray(req.body?.loanLines) ? req.body.loanLines : [];
    const lines = assignAdvanceAccountNumbers(mergeProtectedLoanWorkflow(rawLines, doc), doc);
    validateLoanLineLimits(doc, lines);
    validateLoanFunding(lines);
    await validateLoanLineReports({ req, project, rawLines: lines, currentDoc: doc });
    doc.loanLines = lines.map(normalizeLoanLine);
    await doc.save();

    const control = sharedBuildFinanceControlSummary(doc, project || {});
    const commercialUnits = await getFinanceCommercialUnits(projectId, project.tenantKey);
    res.json({ ok: true, financeControl: control, alerts: sharedBuildFinanceControlAlerts(control, commercialUnits) });
  } catch (err) {
    console.error('PUT finance loan-lines error', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Error al guardar lineas de prestamo' });
  }
});

router.delete('/projects/:projectId/finance/loan-lines/:lineId/entries/:entryId', async (req, res) => {
  try {
    const { projectId, lineId, entryId } = req.params;
    if (![projectId, lineId, entryId].every(mongoose.isValidObjectId)) {
      return res.status(400).json({ error: 'Identificador de desembolso inválido.' });
    }

    const role = String(req.user?.role || '').toLowerCase().trim();
    if (!['admin', 'promoter', 'bank'].includes(role)) {
      return res.status(403).json({ error: 'Solo Promotor, Admin o Banco pueden eliminar una partida de desembolso.' });
    }

    const password = String(req.body?.password || '');
    if (!password) return res.status(400).json({ error: 'Introduce tu contraseña para confirmar la eliminación.' });

    const actorId = req.user?.userId || req.user?._id || req.user?.id || null;
    const actor = mongoose.isValidObjectId(actorId) ? await User.findById(actorId).select('password email role') : null;
    if (!actor || !verifyPassword(password, actor.password)) {
      return res.status(403).json({ error: 'La contraseña no es correcta. No se eliminó la partida.' });
    }

    const project = await loadTenantProject(req, res);
    if (!project) return;
    const doc = await getOrCreate(projectId, project.tenantKey);
    const line = doc.loanLines.id(lineId);
    const entry = line?.entries?.id(entryId);
    if (!line || !entry || entry.entryType !== 'disbursement') {
      return res.status(404).json({ error: 'Partida de desembolso no encontrada.' });
    }

    const deletedEntry = entry.toObject ? entry.toObject() : { ...entry };
    line.entries.pull(entryId);
    await doc.save();

    await audit(req, 'finance.disbursement_deleted', {
      tenantKey: project.tenantKey,
      targetType: 'loanLineEntry',
      targetId: entryId,
      projectId: project._id,
      message: `Partida de desembolso eliminada por ${role}`,
      metadata: {
        lineId: String(lineId),
        lineName: String(line.name || ''),
        advanceAccountNumber: Number(deletedEntry.advanceAccountNumber || 0) || null,
        fundingParty: deletedEntry.fundingParty || 'bank',
        amount: toNum(deletedEntry.disbursementAmount),
        workflowStatus: loanEntryWorkflowStatus(deletedEntry),
        requestDocumentId: deletedEntry.requestDocumentId ? String(deletedEntry.requestDocumentId) : null
      }
    });

    const control = sharedBuildFinanceControlSummary(doc, project || {});
    const commercialUnits = await getFinanceCommercialUnits(projectId, project.tenantKey);
    res.json({ ok: true, financeControl: control, alerts: sharedBuildFinanceControlAlerts(control, commercialUnits) });
  } catch (err) {
    console.error('DELETE finance disbursement error', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'No se pudo eliminar la partida de desembolso.' });
  }
});

router.patch('/projects/:projectId/finance/loan-lines/:lineId/entries/:entryId/status', async (req, res) => {
  try {
    const { projectId, lineId, entryId } = req.params;
    if (![projectId, lineId, entryId].every(mongoose.isValidObjectId)) return res.status(400).json({ error: 'Identificador de desembolso inválido.' });

    const role = String(req.user?.role || '').toLowerCase().trim();
    const action = String(req.body?.action || '').toLowerCase().trim();
    if (['request', 'contribute'].includes(action) && !['admin', 'promoter'].includes(role)) return res.status(403).json({ error: 'Solo el promotor puede realizar esta acción.' });
    if (action === 'disburse' && !['admin', 'promoter', 'bank'].includes(role)) return res.status(403).json({ error: 'No tienes permisos para confirmar este desembolso.' });
    if (action === 'return' && !['admin', 'bank'].includes(role)) return res.status(403).json({ error: 'Solo el banco o el superadmin pueden devolver una solicitud.' });
    if (action === 'acknowledge_return' && !['admin', 'bank', 'promoter'].includes(role)) return res.status(403).json({ error: 'No tienes permisos para atender esta alerta.' });
    if (!['request', 'contribute', 'return', 'disburse', 'acknowledge_return'].includes(action)) return res.status(400).json({ error: 'Acción de desembolso no válida.' });

    const project = await loadTenantProject(req, res);
    if (!project) return;
    const doc = await getOrCreate(projectId, project.tenantKey);
    const line = doc.loanLines.id(lineId);
    const entry = line?.entries?.id(entryId);
    if (!line || !entry || entry.entryType !== 'disbursement') return res.status(404).json({ error: 'Desembolso no encontrado.' });

    if (!(Number(entry.advanceAccountNumber) > 0)) {
      const highest = (doc.loanLines || []).flatMap(item => item.entries || []).reduce((max, item) => Math.max(max, Number(item?.advanceAccountNumber || 0)), 0);
      entry.advanceAccountNumber = highest + 1;
    }
    const currentStatus = loanEntryWorkflowStatus(entry);
    if (currentStatus === 'disbursed') return res.status(409).json({ error: 'Este desembolso ya está confirmado como desembolsado.' });
    if (['request', 'contribute', 'disburse'].includes(action)) {
      const workflowReport = await validateWorkflowReport({ project, entry });
      if (workflowReport?.sequence) entry.advanceAccountNumber = Number(workflowReport.sequence);
    }

    const actorId = req.user?.userId || req.user?._id || req.user?.id || null;
    const now = new Date();
    if (action === 'request') {
      if (!['bank', 'mixed'].includes(entry.fundingParty)) return res.status(400).json({ error: 'Esta cuenta no incluye aportación del banco.' });
      if (entry.fundingParty === 'mixed' && entry.promoterContributionStatus !== 'contributed') return res.status(409).json({ error: 'Confirma primero la aportación del promotor correspondiente a esta cuenta.' });
      if (toNum(entry.disbursementAmount) <= 0) return res.status(400).json({ error: 'El importe solicitado al banco debe ser mayor que cero.' });
      if (currentStatus === 'requested') return res.status(409).json({ error: 'Este desembolso ya está solicitado.' });
      if (req.body?.requirementsConfirmed !== true) return res.status(400).json({ error: 'Confirma que has revisado los requisitos de la fase.' });

      const documentId = String(req.body?.documentId || '');
      if (!mongoose.isValidObjectId(documentId)) return res.status(400).json({ error: 'Adjunta la carta de solicitud firmada en PDF.' });
      const requestDocument = await Document.findOne({ _id: documentId, projectId: project._id, tenantKey: project.tenantKey, category: 'disbursementRequest', status: 'ACTIVE' }).lean();
      const isPdf = requestDocument && (requestDocument.mimetype === 'application/pdf' || String(requestDocument.originalname || '').toLowerCase().endsWith('.pdf'));
      if (!isPdf) return res.status(400).json({ error: 'La carta de solicitud debe ser un PDF del proyecto.' });
      await ensureFinanceRequirements(doc, project, await getFinanceCommercialUnits(projectId, project.tenantKey));

      entry.workflowStatus = 'requested';
      entry.paymentStatus = 'pending';
      entry.requestedAt = now;
      entry.requestedBy = actorId;
      entry.requestedByRole = role;
      entry.requestDocumentId = requestDocument._id;
      entry.requestDocumentName = String(requestDocument.originalname || 'Carta de solicitud.pdf');
      const phase = (line.phaseId ? doc.phases.id(line.phaseId) : null)
        || (doc.phases || []).find(item => String(item?.name || '') === String(line.phaseName || ''))
        || doc.phases?.[0]
        || null;
      const requirementsSnapshot = snapshotPhaseRequirements(phase);
      const requirementIds = requirementsSnapshot.flatMap(item => [item.requirementId, ...(item.legacyRequirementIds || [])]).filter(id => mongoose.isValidObjectId(id));
      const requirementDocuments = requirementIds.length ? await Document.find({
        projectId: project._id,
        tenantKey: project.tenantKey,
        requirementId: { $in: requirementIds },
        status: 'ACTIVE'
      }).select('_id requirementId originalname mimetype').lean() : [];
      entry.requirementsSnapshot = requirementsSnapshot.map(item => ({
        ...item,
        documents: requirementDocuments.filter(document => [item.requirementId, ...(item.legacyRequirementIds || [])].includes(String(document.requirementId))).map(document => ({
          id: String(document._id),
          name: String(document.originalname || 'Documento'),
          mimetype: String(document.mimetype || '')
        }))
      }));
      entry.requirementsConfirmedAt = now;
      entry.requirementsConfirmedBy = actorId;
      entry.requirementsConfirmedByRole = role;
      entry.returnedAt = null;
      entry.returnedBy = null;
      entry.returnedByRole = '';
      entry.returnComment = '';
      entry.returnAlertAcknowledgedAt = null;
      entry.returnAlertAcknowledgedBy = null;
      entry.returnAlertAcknowledgedByRole = '';
    } else if (action === 'contribute') {
      if (entry.fundingParty === 'promoter') entry.promoterContributionAmount = toNum(entry.disbursementAmount);
      if (!['promoter', 'mixed'].includes(entry.fundingParty) || toNum(entry.promoterContributionAmount) <= 0) return res.status(400).json({ error: 'Esta cuenta no tiene aportación del promotor.' });
      if (entry.promoterContributionStatus === 'contributed') return res.status(409).json({ error: 'La aportación del promotor ya está confirmada.' });
      entry.promoterContributionStatus = 'contributed';
      entry.promoterContributedAt = cleanDate(req.body?.contributionDate) || now;
      entry.promoterContributedBy = actorId;
      entry.promoterContributedByRole = role;
      if (entry.fundingParty === 'promoter') {
        entry.workflowStatus = 'disbursed';
        entry.paymentStatus = 'paid';
        entry.disbursementDate = entry.promoterContributedAt;
        entry.disbursedAt = now;
        entry.disbursedBy = actorId;
        entry.disbursedByRole = role;
      }
    } else if (action === 'return') {
      if (currentStatus !== 'requested') return res.status(409).json({ error: 'Solo se puede devolver una solicitud pendiente.' });
      const comment = String(req.body?.comment || '').trim().slice(0, 500);
      if (!comment) return res.status(400).json({ error: 'Indica el motivo de la devolución.' });
      entry.workflowStatus = 'returned';
      entry.paymentStatus = 'pending';
      entry.returnedAt = now;
      entry.returnedBy = actorId;
      entry.returnedByRole = role;
      entry.returnComment = comment;
      entry.returnAlertAcknowledgedAt = null;
      entry.returnAlertAcknowledgedBy = null;
      entry.returnAlertAcknowledgedByRole = '';
    } else if (action === 'acknowledge_return') {
      if (currentStatus !== 'returned') return res.status(409).json({ error: 'Esta alerta ya no corresponde a una solicitud devuelta.' });
      entry.returnAlertAcknowledgedAt = now;
      entry.returnAlertAcknowledgedBy = actorId;
      entry.returnAlertAcknowledgedByRole = role;
    } else {
      if (role === 'bank' && currentStatus !== 'requested') return res.status(409).json({ error: 'El banco solo puede confirmar solicitudes recibidas.' });
      if (role === 'bank' && !['bank', 'mixed'].includes(entry.fundingParty)) return res.status(400).json({ error: 'Esta cuenta no corresponde al banco.' });
      if (entry.fundingParty === 'mixed' && entry.promoterContributionStatus !== 'contributed') return res.status(409).json({ error: 'Confirma primero la aportación del promotor correspondiente a esta cuenta.' });
      if (toNum(entry.disbursementAmount) <= 0) return res.status(400).json({ error: 'El importe del banco debe ser mayor que cero.' });
      const hasRequirementIssues = currentStatus === 'requested' && (entry.requirementsSnapshot || []).some(item => item?.reviewStatus !== 'compliant');
      const overrideComment = String(req.body?.overrideComment || '').trim().slice(0, 500);
      if (hasRequirementIssues && !overrideComment) return res.status(400).json({ error: 'Hay requisitos pendientes o vencidos. Indica una justificación para continuar.' });
      const transferDate = cleanDate(req.body?.transferDate);
      if (!transferDate) return res.status(400).json({ error: 'Indica la fecha efectiva de la transferencia.' });
      entry.workflowStatus = 'disbursed';
      entry.paymentStatus = 'paid';
      entry.disbursementDate = transferDate;
      entry.disbursedAt = now;
      entry.disbursedBy = actorId;
      entry.disbursedByRole = role;
      entry.transferReference = String(req.body?.transferReference || '').trim().slice(0, 120);
      entry.workflowNote = overrideComment || String(req.body?.note || '').trim().slice(0, 500);
    }

    await doc.save();
    const auditAction = ({ request: 'finance.disbursement_requested', contribute: 'finance.promoter_contribution_confirmed', return: 'finance.disbursement_returned', disburse: 'finance.disbursement_confirmed', acknowledge_return: 'finance.disbursement_return_acknowledged' })[action];
    await audit(req, auditAction, {
      tenantKey: project.tenantKey,
      targetType: 'loanLineEntry',
      targetId: entry._id,
      projectId: project._id,
      message: ({ request: 'Desembolso solicitado por el promotor', contribute: 'Aportación del promotor confirmada', return: 'Solicitud devuelta al promotor', disburse: `Desembolso confirmado por ${role}`, acknowledge_return: 'Alerta de solicitud devuelta marcada como atendida' })[action],
      metadata: { lineId: String(line._id), amount: toNum(entry.disbursementAmount), workflowStatus: entry.workflowStatus }
    });

    const control = sharedBuildFinanceControlSummary(doc, project || {});
    const commercialUnits = await getFinanceCommercialUnits(projectId, project.tenantKey);
    res.json({ ok: true, loanLine: line, entry, financeControl: control, alerts: sharedBuildFinanceControlAlerts(control, commercialUnits) });
  } catch (err) {
    console.error('PATCH disbursement status error', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'No se pudo actualizar el desembolso.' });
  }
});

router.get('/projects/:projectId/finance/disbursement-requests', async (req, res) => {
  try {
    const project = await loadTenantProject(req, res);
    if (!project) return;
    const doc = await getOrCreate(project._id, project.tenantKey);
    const rows = [];
    for (const line of (doc.loanLines || [])) {
      for (const entry of (line.entries || [])) {
        if (entry?.entryType !== 'disbursement' || !['requested', 'returned'].includes(loanEntryWorkflowStatus(entry))) continue;
        rows.push({ line, entry });
      }
    }
    const inspectionIds = rows.map(row => row.entry.inspectionId).filter(Boolean);
    const inspections = await Inspection.find({ _id: { $in: inspectionIds }, projectId: project._id, status: 'finalized' })
      .select('_id reportNumber inspectionDate finalizedAt projectProgressPercent technicalRecommendation sequence accountName revision')
      .lean();
    const inspectionById = new Map(inspections.map(item => [String(item._id), item]));
    res.json({
      project: { id: String(project._id), name: project.name, currency: project.currency || 'PAB' },
      requests: rows.map(({ line, entry }) => {
        const report = inspectionById.get(String(entry.inspectionId || ''));
        const requirements = Array.isArray(entry.requirementsSnapshot) ? entry.requirementsSnapshot : [];
        return {
          lineId: String(line._id),
          lineName: String(line.name || 'Línea bancaria'),
          phaseId: line.phaseId ? String(line.phaseId) : '',
          phaseName: String(line.phaseName || ''),
          entryId: String(entry._id),
          status: loanEntryWorkflowStatus(entry),
          advanceAccountNumber: Number(entry.advanceAccountNumber || 0) || null,
          fundingParty: entry.fundingParty || 'bank',
          bankAmount: toNum(entry.disbursementAmount),
          promoterAmount: toNum(entry.promoterContributionAmount),
          promoterContributionStatus: entry.promoterContributionStatus || 'pending',
          requestedAt: entry.requestedAt,
          returnedAt: entry.returnedAt,
          returnComment: entry.returnComment || '',
          returnAlertAcknowledgedAt: entry.returnAlertAcknowledgedAt || null,
          requestDocument: entry.requestDocumentId ? {
            id: String(entry.requestDocumentId),
            name: entry.requestDocumentName || 'Carta de solicitud.pdf',
            url: `/api/documents/${entry.requestDocumentId}/download`
          } : null,
          report: report ? {
            id: String(report._id),
            number: report.reportNumber || 'Informe de avalúo',
            date: report.inspectionDate || report.finalizedAt,
            progress: Number(report.projectProgressPercent || 0),
            verdict: String(report.technicalRecommendation?.verdict || 'not_assessed'),
            conditions: String(report.technicalRecommendation?.conditions || report.technicalRecommendation?.notes || ''),
            sequence: Number(report.sequence || entry.advanceAccountNumber || 0) || null,
            accountName: String(report.accountName || `Cuenta n.º ${Number(report.sequence || entry.advanceAccountNumber || 0)}`),
            revision: Number(report.revision || 1),
            url: `/api/projects/${project._id}/finance/inspection-reports/${report._id}/report.pdf`
          } : null,
          requirements: requirements.map(item => ({
            ...(item?.toObject ? item.toObject() : item),
            documents: (item?.documents || []).map(document => ({
              id: String(document?.id || ''),
              name: String(document?.name || 'Documento'),
              mimetype: String(document?.mimetype || ''),
              url: document?.id ? `/api/documents/${document.id}/download` : ''
            }))
          })),
          requirementSummary: {
            total: requirements.length,
            compliant: requirements.filter(item => item?.reviewStatus === 'compliant').length,
            issues: requirements.filter(item => item?.reviewStatus !== 'compliant').length
          }
        };
      })
    });
  } catch (err) {
    console.error('GET disbursement requests error', err);
    res.status(500).json({ error: 'No se pudieron cargar las solicitudes de desembolso.' });
  }
});

router.get('/projects/:projectId/finance/avaluation-context', async (req, res) => {
  try {
    const project = await loadTenantProject(req, res);
    if (!project) return;
    const assignments = await ProjectAvaluatorAssignment.find(activeAvaluatorAssignmentFilter(req, project)).select('_id bankTenantKey avaluadorId').lean();
    if (!assignments.length) return res.json({ hasAssignedAvaluator: false, reports: [] });
    const reports = await Inspection.find({
      projectId: project._id,
      projectTenantKey: project.tenantKey,
      bankTenantKey: { $in: assignments.map(item => item.bankTenantKey) },
      status: 'finalized',
      supersededByInspectionId: null
    }).populate('avaluadorId', 'name email').sort({ finalizedAt: -1 }).lean();
    res.json({
      hasAssignedAvaluator: true,
      reports: reports.map(item => ({
        id: String(item._id),
        reportNumber: String(item.reportNumber || ''),
        sequence: Number(item.sequence || 1),
        accountName: String(item.accountName || `Cuenta n.º ${Number(item.sequence || 1)}`),
        revision: Number(item.revision || 1),
        inspectionDate: item.inspectionDate,
        finalizedAt: item.finalizedAt,
        projectProgressPercent: Number(item.projectProgressPercent || 0),
        verdict: String(item.technicalRecommendation?.verdict || 'not_assessed'),
        conditions: String(item.technicalRecommendation?.conditions || item.technicalRecommendation?.notes || ''),
        avaluadorName: String(item.avaluadorId?.name || ''),
        reportPath: `/api/projects/${project._id}/finance/inspection-reports/${item._id}/report.pdf`
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'No se pudieron cargar los informes de avalúo.' });
  }
});

router.get('/projects/:projectId/finance/inspection-reports/:inspectionId/report.pdf', async (req, res) => {
  try {
    const project = await loadTenantProject(req, res);
    if (!project) return;
    if (!mongoose.isValidObjectId(req.params.inspectionId)) return res.status(404).json({ error: 'Informe no encontrado.' });
    const assignments = await ProjectAvaluatorAssignment.find(activeAvaluatorAssignmentFilter(req, project)).select('bankTenantKey').lean();
    const inspection = await Inspection.findOne({
      _id: req.params.inspectionId,
      projectId: project._id,
      projectTenantKey: project.tenantKey,
      bankTenantKey: { $in: assignments.map(item => item.bankTenantKey) },
      status: 'finalized'
    }).lean();
    if (!inspection) return res.status(404).json({ error: 'Informe no encontrado.' });
    const context = await inspectionReportContext.buildInspectionReportContext({
      scope: { bankTenantKey: inspection.bankTenantKey, projectTenantKey: project.tenantKey, projectId: project._id },
      inspection,
      preferFrozen: true
    });
    if (!context) return res.status(404).json({ error: 'Informe no encontrado.' });
    const pdf = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true, info: { Title: `Informe ${inspection.reportNumber}` } });
    res.type('application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${inspection.reportNumber || 'informe-bank73'}.pdf"`);
    pdf.pipe(res);
    await renderInspectionReport(pdf, { context });
    pdf.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: 'No se pudo generar el informe.' });
    else res.end();
  }
});

router.put('/projects/:projectId/finance/unit-amortizations', async (req, res) => {
  try {
    const { projectId } = req.params;
    if (!mongoose.isValidObjectId(projectId)) {
      return res.status(400).json({ error: 'projectId invalido' });
    }

    const project = await loadTenantProject(req, res);
    if (!project) return;

    const doc = await getOrCreate(projectId, project.tenantKey);
    const items = Array.isArray(req.body?.unitAmortizations) ? req.body.unitAmortizations : [];
    doc.unitAmortizations = items.map(normalizeUnitAmortization);
    await doc.save();

    const control = sharedBuildFinanceControlSummary(doc, project || {});
    const commercialUnits = await getFinanceCommercialUnits(projectId, project.tenantKey);
    res.json({ ok: true, financeControl: control, alerts: sharedBuildFinanceControlAlerts(control, commercialUnits) });
  } catch (err) {
    console.error('PUT finance unit-amortizations error', err);
    res.status(500).json({ error: 'Error al guardar amortizaciones por unidad' });
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
      actualStartDate = null,
      actualEndDate = null,
      isCompleted = false,
      completedAt = null,
      uses = [], sources = [],
      planUses = [], planSources = [],
      disbExpected = 0,
      disbActual = 0,
      disbActualAt = null,
      disbRequested = false,
      disbRequestedAt = null,
      interesesDevengados = 0,
      aportesPropios = 0,
      preventas = 0,
      alertDaysBefore = 15,
      financialConditions = {},
      financierBanks = [],
      financingLines = [],
      requirements = []
    } = req.body || {};

    if (!name || !startDate || !endDate) {
      return res.status(400).json({ error: 'Faltan campos requeridos (name, startDate, endDate)' });
    }

    const project = await loadTenantProject(req, res);
    if (!project) return;

    const promoterId = project.assignedPromoters?.[0];
    const promoter = promoterId
      ? await User.findById(promoterId).select('promoterProfile').lean()
      : null;
    const commercialUnits = await getFinanceCommercialUnits(projectId, project.tenantKey);

    const doc = await getOrCreate(projectId, project.tenantKey);
    const phaseSeed = {
      name, startDate, endDate,
      actualStartDate, actualEndDate, isCompleted, completedAt,
      uses, sources,
      planUses, planSources,
      financierBanks: normalizeFinancierBanks(financierBanks),
      financialConditions: normalizePhaseFinancialConditions(financialConditions),
      financingLines: normalizePhaseFinancingLines(financingLines),
      disbExpected, disbActual, disbActualAt: disbActualAt || (toNum(disbActual) > 0 ? new Date() : null), disbRequested, disbRequestedAt,
      interesesDevengados, aportesPropios, preventas,
      alertDaysBefore
    };
    phaseSeed.requirements = normalizePhaseRequirements(requirements, {
      project: project.toObject ? project.toObject() : project,
      promoterProfile: promoter?.promoterProfile || {},
      phase: phaseSeed,
      commercialUnits
    });
    doc.phases.push(phaseSeed);
    syncLoanLinesFromPhaseUses(doc, doc.phases[doc.phases.length - 1], { createAll: true });

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
    const project = await loadTenantProject(req, res);
    if (!project) return;

    const doc = await getOrCreate(projectId, project.tenantKey);
    const ph = doc.phases.id(phaseId);
    if (!ph) return res.status(404).json({ error: 'Fase no encontrada' });
    const previousPlanUseIds = new Set((ph.planUses || []).map(use => String(use?._id || '')));
    const hadActualDisbursement = toNum(ph.disbActual) > 0;
    const requirementCommercialUnits = 'requirements' in req.body
      ? await getFinanceCommercialUnits(projectId, project.tenantKey)
      : [];
    const requirementPromoterId = 'requirements' in req.body ? project.assignedPromoters?.[0] : null;
    const requirementPromoter = requirementPromoterId
      ? await User.findById(requirementPromoterId).select('promoterProfile').lean()
      : null;

    const fields = [
      'name','startDate','endDate',
      'actualStartDate','actualEndDate','isCompleted','completedAt',
      'uses','sources',
      'planUses','planSources',
      'financialConditions','financierBanks','financingLines','requirements',
      'disbExpected','disbActual','disbActualAt','disbRequested','disbRequestedAt',
      'interesesDevengados','aportesPropios','preventas',
      'alertDaysBefore','alerted'
    ];
    for (const f of fields) {
      if (!(f in req.body)) continue;
      if (f === 'financialConditions') ph[f] = normalizePhaseFinancialConditions(req.body[f] || {});
      else if (f === 'financierBanks') ph[f] = normalizeFinancierBanks(req.body[f] || []);
      else if (f === 'financingLines') ph[f] = normalizePhaseFinancingLines(req.body[f] || []);
      else if (f === 'requirements') ph[f] = normalizePhaseRequirements(req.body[f] || [], {
        project: project.toObject ? project.toObject() : project,
        promoterProfile: requirementPromoter?.promoterProfile || {},
        phase: ph.toObject ? ph.toObject() : ph,
        commercialUnits: requirementCommercialUnits
      });
      else ph[f] = req.body[f];
    }
    if (!hadActualDisbursement && toNum(ph.disbActual) > 0 && !ph.disbActualAt) {
      ph.disbActualAt = new Date();
    }
    if ('isCompleted' in req.body) {
      if (ph.isCompleted && !ph.completedAt) ph.completedAt = new Date();
      if (!ph.isCompleted && !('completedAt' in req.body)) ph.completedAt = null;
    }

    if ('planUses' in req.body || 'planSources' in req.body || 'financialConditions' in req.body) {
      const newUseIds = new Set((ph.planUses || []).map(use => String(use?._id || '')).filter(useId => useId && !previousPlanUseIds.has(useId)));
      syncLoanLinesFromPhaseUses(doc, ph, { createForUseIds: newUseIds });
      validateLoanLineLimits(doc, doc.loanLines || []);
    }

    await doc.save();
    res.json({ ok: true, phase: ph, kpis: doc.kpis() });
  } catch (err) {
    console.error('PUT phase error', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Error al actualizar fase' });
  }
});

router.delete('/projects/:projectId/finance/phases/:phaseId', async (req, res) => {
  try {
    const { projectId, phaseId } = req.params;

    if (!mongoose.isValidObjectId(projectId) || !mongoose.isValidObjectId(phaseId)) {
      return res.status(400).json({ error: 'IDs inválidos' });
    }

    const project = await loadTenantProject(req, res);
    if (!project) return;

    const doc = await getOrCreate(projectId, project.tenantKey);
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
    const project = await loadTenantProject(req, res);
    if (!project) return;

    const doc = await getOrCreate(projectId, project.tenantKey);
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

function buildFinanceSnapshot(doc, phaseId = '') {
  const selectedPhaseId = String(phaseId || '');
  const firstPhaseId = String(doc.phases?.[0]?._id || '');
  const phases = (doc.phases || []).filter(p => !selectedPhaseId || String(p?._id || '') === selectedPhaseId).map(p => {
    const planUses = sumItems(p.planUses);
    const planSources = sumItems(p.planSources);
    const realUses = sumItems(p.uses);
    const realSources = sumItems(p.sources);

    const loanLines = (doc.loanLines || []).filter(line => (
      String(line?.phaseId || '') === String(p?._id || '') || (!line?.phaseId && String(p?._id || '') === firstPhaseId)
    )).map(line => {
      const entries = (line.entries || []).map(entry => ({
        entryType: entry.entryType || 'legacy',
        paymentStatus: entry.paymentStatus || 'legacy',
        workflowStatus: loanEntryWorkflowStatus(entry),
        advanceAccountNumber: Number(entry.advanceAccountNumber || 0) || '',
        fundingParty: entry.fundingParty || 'bank',
        promoterContributionAmount: toNum(entry.promoterContributionAmount),
        promoterContributionStatus: entry.promoterContributionStatus || 'pending',
        requestedAt: entry.requestedAt || null,
        requestedByRole: entry.requestedByRole || '',
        disbursedAt: entry.disbursedAt || null,
        disbursedByRole: entry.disbursedByRole || '',
        transferReference: entry.transferReference || '',
        date: entry.movementDate || entry.disbursementDate || null,
        loanNumber: entry.loanNumber || '',
        disbursementAmount: toNum(entry.disbursementAmount),
        maturityDate: entry.maturityDate || null,
        amortizedAmount: toNum(entry.amortizedAmount),
        inspectionId: entry.inspectionId ? String(entry.inspectionId) : '',
        notes: entry.notes || ''
      }));
      const salesAmortizations = (doc.unitAmortizations || []).flatMap(unit => (unit.allocations || [])
        .filter(allocation => String(allocation?.loanLineId || '') === String(line?._id || '') || (!allocation?.loanLineId && String(allocation?.loanLineName || '') === String(line?.name || '')))
        .map(allocation => ({
          entryType: 'sale_amortization',
          paymentStatus: 'automatic',
          date: unit.checkDate || null,
          loanNumber: unit.checkNumber || unit.lot || '',
          disbursementAmount: 0,
          maturityDate: null,
          amortizedAmount: toNum(allocation.amount),
          inspectionId: '',
          notes: [unit.lot, unit.clientName].filter(Boolean).join(' · ')
        })));
      return {
        id: String(line._id || ''),
        name: line.name || 'Línea',
        approvedAmount: toNum(line.approvedAmount),
        approvedAmountMode: line.approvedAmountMode || 'manual',
        notes: line.notes || '',
        entries: [...entries, ...salesAmortizations]
      };
    });

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
      loanLines,
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

async function exportFinanceXlsx({ req, res, projectId, projectName, updatedAt, doc, kpis, chartsPayload, phaseId = '' }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TrustForBanks';
  wb.created = new Date();

  const snap = buildFinanceSnapshot(doc, phaseId);

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

  // ===== Líneas y movimientos =====
  const sh4 = wb.addWorksheet('Líneas');
  sh4.addRow(['Fase', 'Línea', 'Aprobado', 'Desembolsado pagado', 'Amortizado', 'Saldo', 'Cálculo', 'Notas']);
  styleSheetHeaderRow(sh4.getRow(1));
  const sh5 = wb.addWorksheet('Movimientos');
  sh5.addRow(['Fase', 'Línea', 'Cuenta de avance', 'Tipo', 'Quién aporta', 'Fecha', 'No. préstamo', 'Banco', 'Aporte promotor', 'Vencimiento', 'Amortización', 'Estado', 'Solicitado', 'Confirmado por', 'Referencia', 'Informe de avalúo', 'Notas']);
  styleSheetHeaderRow(sh5.getRow(1));
  snap.phases.forEach(phase => (phase.loanLines || []).forEach(line => {
    const disbursed = (line.entries || []).reduce((sum, entry) => sum + (entry.entryType === 'disbursement' && entry.paymentStatus === 'pending' ? 0 : toNum(entry.disbursementAmount)), 0);
    const amortized = (line.entries || []).reduce((sum, entry) => sum + toNum(entry.amortizedAmount), 0);
    sh4.addRow([phase.name, line.name, line.approvedAmount, disbursed, amortized, Math.max(0, disbursed - amortized), line.approvedAmountMode === 'auto' ? 'Automático' : 'Manual', line.notes]);
    (line.entries || []).forEach(entry => sh5.addRow([
      phase.name, line.name, entry.advanceAccountNumber, entry.entryType, entry.fundingParty, entry.date ? new Date(entry.date) : '', entry.loanNumber,
      ['bank', 'mixed'].includes(entry.fundingParty || 'bank') ? entry.disbursementAmount : 0,
      entry.fundingParty === 'promoter' ? entry.disbursementAmount : entry.promoterContributionAmount,
      entry.maturityDate ? new Date(entry.maturityDate) : '', entry.amortizedAmount,
      entry.workflowStatus || entry.paymentStatus, entry.requestedAt ? new Date(entry.requestedAt) : '', entry.disbursedByRole,
      entry.transferReference, entry.inspectionId, entry.notes
    ]));
  }));
  [sh4, sh5].forEach(sheet => autoFitColumns(sheet, 46));
  for (let row = 2; row <= sh4.rowCount; row++) [3, 4, 5, 6].forEach(column => { sh4.getRow(row).getCell(column).numFmt = '#,##0.00'; });
  for (let row = 2; row <= sh5.rowCount; row++) {
    sh5.getRow(row).getCell(6).numFmt = 'yyyy-mm-dd';
    sh5.getRow(row).getCell(8).numFmt = '#,##0.00';
    sh5.getRow(row).getCell(9).numFmt = '#,##0.00';
    sh5.getRow(row).getCell(10).numFmt = 'yyyy-mm-dd';
    sh5.getRow(row).getCell(11).numFmt = '#,##0.00';
    sh5.getRow(row).getCell(13).numFmt = 'yyyy-mm-dd';
  }

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
  res.setHeader('Content-Disposition', `attachment; filename="${phaseId ? `fase_${phaseId}` : `finanzas_${projectId}`}.xlsx"`);
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

function financePdfKpiCards(doc, snap, projectCurrency = 'PAB') {
  const margin = doc.page.margins.left;
  const pageW = doc.page.width;
  const contentW = pageW - margin*2;

  const cardW = (contentW - 12) / 2;
  const cardH = 64;

  const kpis = [
    { label: 'Ejecución (Real/Plan usos)', value: `${(snap.percentExecution * 100).toFixed(1)}%` },
    { label: 'Intereses acumulados', value: moneyES(snap.totals.intereses, projectCurrency) },
    { label: 'Preventas acumuladas', value: moneyES(snap.totals.preventas, projectCurrency) },
    { label: 'Desembolso real (total)', value: moneyES(snap.totals.disbActual, projectCurrency) },
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

async function exportFinancePdf({ req, res, projectId, projectName, projectCurrency = 'PAB', updatedAt, doc, chartsPayload, phaseId = '' }) {
  const snap = buildFinanceSnapshot(doc, phaseId);
  const money = (n) => moneyES(n, projectCurrency);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${phaseId ? `fase_${phaseId}` : `finanzas_${projectId}`}.pdf"`);

  // bufferPages para footer con total
  const pdf = new PDFDocument({ margin: 40, bufferPages: true });
  pdf.pipe(res);

  // Portada + header
  financePdfHeader(pdf, { projectName, updatedAt });
  pdf.__projectName = projectName;
  pdf.__updatedAt = updatedAt;

  // KPI cards
  financePdfKpiCards(pdf, snap, projectCurrency);

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
    { c:'Plan usos', v: money(snap.totals.planUses) },
    { c:'Plan fuentes', v: money(snap.totals.planSources) },
    { c:'Real usos', v: money(snap.totals.realUses) },
    { c:'Real fuentes', v: money(snap.totals.realSources) },
    { c:'Ejecución', v: `${(snap.percentExecution * 100).toFixed(1)}%` },
    { c:'Intereses', v: money(snap.totals.intereses) },
    { c:'Preventas', v: money(snap.totals.preventas) },
    { c:'Aportes propios', v: money(snap.totals.aportes) },
    { c:'Desembolso esperado', v: money(snap.totals.disbExpected) },
    { c:'Desembolso real', v: money(snap.totals.disbActual) },
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
    plan: money(p.planUses),
    real: money(p.realUses),
    disb: `${money(p.disbActual)}${p.disbRequested ? ' (SOL)' : ''}`,
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
      { c:'Plan usos', v: money(p.planUses) },
      { c:'Plan fuentes', v: money(p.planSources) },
      { c:'Real usos', v: money(p.realUses) },
      { c:'Real fuentes', v: money(p.realSources) },
      { c:'Intereses', v: money(p.intereses) },
      { c:'Preventas', v: money(p.preventas) },
      { c:'Aportes', v: money(p.aportes) },
      { c:'Desembolso esperado', v: money(p.disbExpected) },
      { c:'Desembolso real', v: money(p.disbActual) },
      { c:'Solicitado', v: p.disbRequested ? 'SI' : 'NO' },
    ], [
      { key:'c', label:'Concepto', wPct:0.66, align:'left' },
      { key:'v', label:'Valor', wPct:0.34, align:'right' },
    ]);

    const mkRows = (items) => (items || []).map(it => ({
      n: String(it?.name || '—'),
      a: money(it?.amount || 0)
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

    financePdfSection(pdf, 'Líneas bancarias');
    const lineRows = (p.loanLines || []).map(line => {
      const disbursed = (line.entries || []).reduce((sum, entry) => sum + (entry.entryType === 'disbursement' && entry.paymentStatus === 'pending' ? 0 : toNum(entry.disbursementAmount)), 0);
      const amortized = (line.entries || []).reduce((sum, entry) => sum + toNum(entry.amortizedAmount), 0);
      return { name: line.name, approved: money(line.approvedAmount), disbursed: money(disbursed), amortized: money(amortized), balance: money(Math.max(0, disbursed - amortized)) };
    });
    financePdfTable(pdf, lineRows, [
      { key:'name', label:'Línea', wPct:0.28, align:'left' },
      { key:'approved', label:'Aprobado', wPct:0.18, align:'right' },
      { key:'disbursed', label:'Desemb.', wPct:0.18, align:'right' },
      { key:'amortized', label:'Amort.', wPct:0.18, align:'right' },
      { key:'balance', label:'Saldo', wPct:0.18, align:'right' },
    ]);

    for (const line of (p.loanLines || [])) {
      if (!(line.entries || []).length) continue;
      financePdfSection(pdf, `Movimientos — ${line.name}`);
      financePdfTable(pdf, line.entries.map(entry => ({
        type: entry.entryType === 'sale_amortization' ? 'Venta' : entry.entryType === 'manual_amortization' ? 'Amortización' : entry.entryType === 'disbursement' ? `Cuenta ${entry.advanceAccountNumber || '—'} · ${entry.fundingParty === 'mixed' ? 'Mixta' : entry.fundingParty === 'promoter' ? 'Promotor' : 'Banco'}` : 'Histórico',
        date: fmtDate(entry.date),
        disbursed: money(entry.disbursementAmount),
        amortized: money(entry.amortizedAmount),
        status: entry.workflowStatus === 'requested' ? 'Solicitado' : entry.workflowStatus === 'returned' ? 'Devuelto' : entry.workflowStatus === 'prepared' ? 'Preparado' : entry.paymentStatus === 'automatic' ? 'Automática' : 'Desembolsado'
      })), [
        { key:'type', label:'Tipo', wPct:0.24, align:'left' },
        { key:'date', label:'Fecha', wPct:0.18, align:'left' },
        { key:'disbursed', label:'Desembolso', wPct:0.22, align:'right' },
        { key:'amortized', label:'Amortización', wPct:0.22, align:'right' },
        { key:'status', label:'Estado', wPct:0.14, align:'left' },
      ]);
    }
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

    const project = await loadTenantProject(req, res);
    if (!project) return;

    const doc = await getOrCreate(projectId, project.tenantKey);
    const kpis = doc.kpis ? doc.kpis() : {};
    const exportPhaseId = String(req.query?.phaseId || req.body?.phaseId || '').trim();
    if (exportPhaseId && !mongoose.isValidObjectId(exportPhaseId)) return res.status(400).json({ error: 'phaseId inválido' });
    if (exportPhaseId && !doc.phases.id(exportPhaseId)) return res.status(404).json({ error: 'Fase no encontrada' });

    const projectName = project?.name || 'Proyecto';
    const projectCurrency = project?.currency || 'PAB';
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
        req, res, projectId, projectName, projectCurrency, updatedAt, doc, kpis, chartsPayload, phaseId: exportPhaseId
      });
    }

    // pdf
    return exportFinancePdf({
      req, res, projectId, projectName, projectCurrency, updatedAt, doc, chartsPayload, phaseId: exportPhaseId
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
