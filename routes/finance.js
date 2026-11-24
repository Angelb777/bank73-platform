// routes/finance.js
const express = require('express');
const router = express.Router();
const bankReadOnly = require('../middleware/bankReadOnly');
const mongoose = require('mongoose');

const ProjectFinance = require('../models/ProjectFinance');
const CommercialFolder = require('../models/CommercialFolder');
const Project = require('../models/Project');
const Unit = require('../models/Unit');
const Venta = require('../models/Venta');
const User = require('../models/User');
const Inspection = require('../models/Inspection');
const Document = require('../models/Document');
const ProjectAvaluatorAssignment = require('../models/ProjectAvaluatorAssignment');
const { requireProjectAccess } = require('../middleware/rbac');
const {
  REQUIREMENT_TITLES,
  PROMOTER_EXPERIENCE_FIELDS,
  normalizePhaseRequirements,
  normalizeRequirementCategory,
  normalizeRequirementTrackingType
} = require('../services/phaseRequirements');
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
const { customerPaymentRecipientTotals, customerPaymentSummary } = require('../services/customerPayments');
const { reconcileProjectStages, syncStageName } = require('../services/projectStages');

router.use(bankReadOnly);
router.use('/projects/:projectId/finance', requireProjectAccess({ commercialOnlySales: false }));

const fs   = require('fs');
const path = require('path');
const { fetchRemoteImage } = require('../utils/remoteImage');

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { formatProjectMoney } = require('../utils/currency');
const multer = require('multer');
const {
  MAX_EXCEL_IMPORT_FILE_SIZE,
  MAX_DOCUMENT_FILE_SIZE,
  fileFilterFor,
  handleMulterUpload
} = require('../utils/uploadSecurity');

const financeExcelUpload = handleMulterUpload(multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_EXCEL_IMPORT_FILE_SIZE },
  fileFilter: fileFilterFor(new Set(['.xlsx']))
}).single('file'));

const externalInspectionUploadDir = path.join(__dirname, '..', 'uploads');
if (!fs.existsSync(externalInspectionUploadDir)) fs.mkdirSync(externalInspectionUploadDir, { recursive: true });
const externalInspectionUpload = handleMulterUpload(multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, externalInspectionUploadDir),
    filename: (_req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname || '').toLowerCase()}`)
  }),
  limits: { fileSize: MAX_DOCUMENT_FILE_SIZE },
  fileFilter: fileFilterFor(new Set(['.pdf']))
}).single('report'));

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
    const comparable = item => {
      const raw = item?.toObject ? item.toObject() : (item || {});
      return {
        code: String(raw.code || ''), number: Number(raw.number || 0), title: String(raw.title || ''),
        category: String(raw.category || ''), trackingType: String(raw.trackingType || ''),
        responsibleDepartment: String(raw.responsibleDepartment || ''), sortOrder: Number(raw.sortOrder || 0),
        isCustom: raw.isCustom === true, isArchived: raw.isArchived === true,
        information: String(raw.information || ''), manualInformation: String(raw.manualInformation || ''),
        structuredData: raw.structuredData || null, sourceKey: String(raw.sourceKey || ''),
        sourceLabel: String(raw.sourceLabel || ''), status: String(raw.status || ''),
        observations: String(raw.observations || '')
      };
    };
    const needsNormalization = JSON.stringify(current.map(comparable)) !== JSON.stringify(normalized.map(comparable));
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
  const entryType = ['disbursement', 'manual_amortization', 'interest_payment'].includes(raw.entryType) ? raw.entryType : 'legacy';
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
    interestAmount: Math.max(0, toNum(raw.interestAmount)),
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
  return (phase?.requirements || []).filter(item => item?.isArchived !== true).map((item, index) => {
    const raw = item?.toObject ? item.toObject() : item;
    const validity = String(raw?.structuredData?.validityStatus || '').toUpperCase();
    const compliant = String(raw?.status || '').toUpperCase() === 'CUMPLIDO' && !['EXPIRED', 'MISSING'].includes(validity);
    return {
      requirementId: raw?._id ? String(raw._id) : '',
      legacyRequirementIds: Array.isArray(raw?.legacyRequirementIds) ? raw.legacyRequirementIds.map(String) : [],
      number: Number(raw?.number || index + 1),
      title: String(raw?.title || `Requisito ${index + 1}`).trim(),
      category: String(raw?.category || 'general'),
      trackingType: String(raw?.trackingType || 'none'),
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
        e.disbursementDate || e.movementDate || e.loanNumber || e.disbursementAmount || e.maturityDate || e.amortizedAmount || e.interestAmount || e.notes
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
    entry?.inspectionId || toNum(entry?.disbursementAmount) || toNum(entry?.amortizedAmount) || toNum(entry?.interestAmount) || String(entry?.notes || '').trim()
  )) || toNum(line.disbursementAmount) || toNum(line.amortizedAmount);
}

function phaseBankApproved(phase = {}) {
  const bankSources = (phase.planSources || []).filter(item => /banco|financiacion bancaria|prestamo/.test(normalizedFinanceName(item?.name)));
  return bankSources.length
    ? bankSources.reduce((sum, item) => sum + Math.max(0, toNum(item?.amount)), 0)
    : Math.max(0, toNum(phase?.financialConditions?.bankFinancedAmount));
}

function plannedBankForUse(use = {}) {
  if (!Array.isArray(use?.fundingSources)) return null;
  return use.fundingSources.reduce((sum, source) => (
    /banco|financiacion bancaria|prestamo/.test(normalizedFinanceName(source?.name))
      ? sum + Math.max(0, toNum(source?.amount))
      : sum
  ), 0);
}

function syncLoanLinesFromPhaseUses(doc, phase, { createAll = false, createForUseIds = new Set() } = {}) {
  const phaseId = String(phase?._id || '');
  if (!phaseId) return;
  const uses = Array.from(phase.uses || []).filter(use => String(use?.name || '').trim() || toNum(use?.amount));
  const legacyPlanUseIds = new Set((phase.planUses || []).map(use => String(use?._id || '')).filter(Boolean));
  const isFirstPhase = String(doc.phases?.[0]?._id || '') === phaseId;
  const phaseLines = Array.from(doc.loanLines || []).filter(line => String(line?.phaseId || '') === phaseId || (isFirstPhase && !line?.phaseId));
  const claimedLineIds = new Set();

  for (const use of uses) {
    const useId = String(use?._id || '');
    let line = phaseLines.find(item => String(item?.sourceUseId || '') === useId);
    if (!line) {
      line = phaseLines.find(item => (
        !claimedLineIds.has(String(item?._id || '')) &&
        normalizedFinanceName(item?.name) === normalizedFinanceName(use?.name) &&
        (!item?.sourceUseId ||
          (item?.approvedAmountMode === 'auto' && legacyPlanUseIds.has(String(item?.sourceUseId || ''))))
      ));
      if (line) {
        const shouldBecomeAutomatic = line.approvedAmountMode === 'auto' ||
          (!toNum(line.approvedAmount) && !loanLineHasMovements(line));
        line.sourceUseId = use._id;
        if (shouldBecomeAutomatic) line.approvedAmountMode = 'auto';
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
  const hasFundingByUse = autoLines.some(line => plannedBankForUse(useById.get(String(line.sourceUseId))) !== null);
  const allocationBasis = autoLines.map(line => {
    const use = useById.get(String(line.sourceUseId));
    const plannedBank = plannedBankForUse(use);
    return hasFundingByUse ? Math.max(0, plannedBank || 0) : Math.max(0, toNum(use?.amount));
  });
  const allocationBasisTotal = allocationBasis.reduce((sum, amount) => sum + amount, 0);
  const floors = autoLines.map(line => loanLineEffectiveDisbursed(line));
  const floorTotal = floors.reduce((sum, amount) => sum + amount, 0);
  let remaining = Math.max(0, available - floorTotal);
  const desired = autoLines.map((line, index) => allocationBasisTotal > 0
    ? available * allocationBasis[index] / allocationBasisTotal
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
      const weight = allocationBasisTotal > 0
        ? allocationBasis[index] / allocationBasisTotal
        : 1 / autoLines.length;
      allocations[index] += remaining * weight;
    });
  }
  autoLines.forEach((line, index) => { line.approvedAmount = Math.round(allocations[index] * 100) / 100; });
}

function activeAvaluatorAssignmentFilter(req, project) {
  const filter = { projectId: project._id, projectTenantKey: project.tenantKey, status: 'active' };
  if (req.user?.role === 'bank') {
    const bankKeys = Array.from(new Set([...(req.user?.tenantKeys || []), getTenantKey(req)].map(String).filter(Boolean)));
    if (bankKeys.length) filter.bankTenantKey = { $in: bankKeys };
  }
  if (req.user?.role === 'avaluador') filter.avaluadorId = req.user?._id || req.user?.userId || req.user?.id;
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
      if (previous?.inspectionId && String(previous.inspectionId) !== String(entry.inspectionId || '')) {
        throw Object.assign(new Error('El informe vinculado a un desembolso guardado no se puede sustituir.'), { status: 409 });
      }
      // El informe es opcional: muchos desembolsos históricos no disponen de
      // uno. Si existe, mantenemos todas las validaciones y su trazabilidad.
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
  if (!entry?.inspectionId) return null;
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

const FINANCE_LINE_IMPORT_HEADERS = [
  'Fase', 'Línea', 'Aprobado', 'Desembolsado banco', 'Disponible',
  'Amortización manual', 'Amortización por ventas', 'Otras amortizaciones',
  'Amortización total', 'Intereses pagados', 'Total pagado banco',
  'Capital pendiente', '% amortizado', 'Notas'
];

const FINANCE_MOVEMENT_IMPORT_HEADERS = [
  'Fase', 'Línea', 'Cuenta avance', 'Tipo', 'Aportante', 'Fecha',
  'Nº préstamo', 'Desembolso banco', 'Aporte promotor', 'Importe pendiente',
  'Amortización', 'Interés pagado', 'Pago al banco', 'Vencimiento', 'Estado',
  'Solicitud', 'Confirmado por', 'Referencia', 'Informe avalúo',
  'Detalle / unidad', 'Notas'
];

const FINANCE_USE_SOURCE_IMPORT_HEADERS = [
  'Fase', 'Grupo', 'Partida', 'Plan', 'Real', 'Desviación', '% ejecución'
];

const FINANCE_CUSTOMER_PAYMENT_IMPORT_HEADERS = [
  'Unidad', 'Cliente', 'Concepto', 'Beneficiario', 'Fecha del abono',
  'Nº recibo', 'Importe pago', 'Total acordado', 'Pagado acumulado',
  'Saldo pendiente', 'Estado'
];

function normalizeFinanceExcelLabel(value = '') {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/n[º°]/g, 'n').replace(/[^a-z0-9%]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function normalizeFinanceUnitAlias(value = '') {
  // 74A, 74-A, 74 A y L-74A representan la misma unidad comercial.
  return normalizeFinanceExcelLabel(value).replace(/\s+/g, '').replace(/^l(?=\d)/, '');
}

function financeExcelCellValue(cell) {
  const value = cell?.value;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    if ('result' in value) return value.result;
    if (Array.isArray(value.richText)) return value.richText.map(item => item.text || '').join('');
    if ('text' in value) return value.text;
  }
  return value;
}

function financeExcelText(cell) {
  const value = financeExcelCellValue(cell);
  return value === null || value === undefined ? '' : String(value).trim();
}

function financeExcelNumber(cell, { sheet, row, column, errors, required = false } = {}) {
  const raw = financeExcelCellValue(cell);
  if (raw === '' || raw === null || raw === undefined) {
    if (required) errors.push(`${sheet}, fila ${row}: ${column} es obligatorio.`);
    return 0;
  }
  const number = typeof raw === 'number' ? raw : Number(String(raw).replace(/[, ]/g, ''));
  if (!Number.isFinite(number) || number < 0) {
    errors.push(`${sheet}, fila ${row}: ${column} debe ser un número igual o mayor que cero.`);
    return 0;
  }
  return number;
}

function financeExcelDate(cell, { sheet, row, column, errors } = {}) {
  const raw = financeExcelCellValue(cell);
  if (raw === '' || raw === null || raw === undefined) return null;
  let date = raw instanceof Date ? new Date(raw) : null;
  if (!date && typeof raw === 'number') {
    const parsed = ExcelJS.DateUtils?.excelToDate?.(raw);
    date = parsed instanceof Date ? parsed : new Date(Date.UTC(1899, 11, 30) + raw * 86400000);
  }
  if (!date) date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    errors.push(`${sheet}, fila ${row}: ${column} no contiene una fecha válida.`);
    return null;
  }
  return date;
}

function validateFinanceExcelHeaders(worksheet, expected, errors, warnings = [], requiredIndexes = []) {
  if (!worksheet) return;
  const actual = expected.map((_, index) => normalizeFinanceExcelLabel(financeExcelText(worksheet.getRow(5).getCell(index + 1))));
  const wanted = expected.map(normalizeFinanceExcelLabel);
  wanted.forEach((header, index) => {
    if (actual[index] !== header) {
      const message = `${worksheet.name}, columna ${index + 1}: se esperaba “${expected[index]}” y se encontró “${financeExcelText(worksheet.getRow(5).getCell(index + 1)) || 'vacío'}”.`;
      (requiredIndexes.includes(index) ? errors : warnings).push(message);
    }
  });
}

function financeMovementImportType(value = '') {
  const type = normalizeFinanceExcelLabel(value);
  if (type === 'desembolso') return 'disbursement';
  if (type === 'amortizacion manual') return 'manual_amortization';
  if (type === 'amortizacion por venta') return 'sale_amortization';
  if (type === 'interes pagado') return 'interest_payment';
  if (type === 'historico') return 'legacy';
  return '';
}

function financeImportedMovementFingerprint(entry = {}) {
  const dateKey = value => {
    if (!value) return '';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
  };
  return [
    entry.entryType || 'legacy', dateKey(entry.movementDate || entry.disbursementDate),
    String(entry.loanNumber || '').trim().toLowerCase(), toNum(entry.disbursementAmount).toFixed(2),
    toNum(entry.promoterContributionAmount).toFixed(2), toNum(entry.amortizedAmount).toFixed(2),
    toNum(entry.interestAmount).toFixed(2), dateKey(entry.maturityDate),
    String(entry.transferReference || '').trim().toLowerCase(), String(entry.notes || '').trim().toLowerCase()
  ].join('|');
}

function financeCustomerPaymentRecipient(value = '') {
  const recipient = normalizeFinanceExcelLabel(value);
  if (recipient === 'banco') return 'bank';
  if (recipient === 'otro' || recipient === 'otra') return 'other';
  return 'promoter';
}

function financeImportedCustomerPaymentFingerprint(payment = {}) {
  const date = payment.paymentDate ? new Date(payment.paymentDate) : null;
  const dateKey = date && !Number.isNaN(date.getTime()) ? date.toISOString().slice(0, 10) : '';
  return [
    dateKey,
    String(payment.recipient || 'promoter').trim().toLowerCase(),
    String(payment.receiptNumber || '').trim().toLowerCase(),
    toNum(payment.amount).toFixed(2)
  ].join('|');
}

function uniqueFinanceUnitCandidates(rawMatches = [], rawUnitLabel = '') {
  const matchesByUnit = new Map();
  rawMatches.forEach(item => {
    const canonicalUnitId = String(item.unitId || item.__commercialSource?.unitId || '');
    const canonicalLot = normalizeFinanceUnitAlias(item.lot || item.__commercialSource?.lot || rawUnitLabel);
    const key = canonicalUnitId ? `unit:${canonicalUnitId}` : canonicalLot ? `lot:${canonicalLot}` : `record:${String(item._id || '')}`;
    const current = matchesByUnit.get(key);
    if (!current || (current.__commercialSource && !item.__commercialSource)) matchesByUnit.set(key, item);
  });
  let matches = [...matchesByUnit.values()];
  if (matches.length > 1) {
    const identifiedMatches = matches.filter(item => item.unitId || item.__commercialSource?.unitId);
    if (identifiedMatches.length === 1) matches = identifiedMatches;
  }
  return matches;
}

function financeUnitCandidatesByAlias(aliasMap, rawUnitLabel = '') {
  const key = normalizeFinanceUnitAlias(String(rawUnitLabel || '').split('·')[0].trim());
  if (!key) return [];
  const exact = uniqueFinanceUnitCandidates(aliasMap.get(key) || [], rawUnitLabel);
  if (exact.length) return exact;
  // Admitimos prefijos habituales (fase, torre, manzana) cuando el resultado
  // sigue identificando de forma inequívoca una sola unidad.
  if (key.length < 3) return [];
  const approximate = [];
  for (const [candidateKey, candidates] of aliasMap.entries()) {
    if (candidateKey.length < 3 || (!candidateKey.endsWith(key) && !key.endsWith(candidateKey))) continue;
    approximate.push(...candidates);
  }
  return uniqueFinanceUnitCandidates(approximate, rawUnitLabel);
}

function selectFinanceUnitCandidate(matches = []) {
  const score = item => (
    (item.__commercialSource ? 0 : 100) +
    ((item.allocations || []).length ? 50 : 0) +
    ((item.unitId || item.__commercialSource?.unitId) ? 20 : 0) +
    (item.clientName ? 5 : 0)
  );
  return [...matches].sort((a, b) => {
    const scoreDiff = score(b) - score(a);
    if (scoreDiff) return scoreDiff;
    const aId = String(a.unitId || a.__commercialSource?.unitId || a._id || '');
    const bId = String(b.unitId || b.__commercialSource?.unitId || b._id || '');
    return aId.localeCompare(bId);
  })[0] || null;
}

function financeImportedUsesWithFunding(uses = [], sources = [], lines = []) {
  const safeUses = uses.map(item => ({ name: String(item?.name || '').trim(), amount: Math.max(0, toNum(item?.amount)) }));
  const allocations = safeUses.map(() => []);
  const remaining = safeUses.map(item => item.amount);
  const bankSources = sources.filter(source => /banco|financiacion bancaria|prestamo/.test(normalizedFinanceName(source?.name)));
  const otherSources = sources.filter(source => !bankSources.includes(source));
  let bankRemaining = bankSources.reduce((sum, source) => sum + Math.max(0, toNum(source?.amount)), 0);
  const lineByName = new Map(lines.map(line => [normalizedFinanceName(line?.name), line]));

  safeUses.forEach((use, index) => {
    const line = lineByName.get(normalizedFinanceName(use.name));
    const amount = Math.min(remaining[index], Math.max(0, toNum(line?.approvedAmount)), bankRemaining);
    if (amount > 0) {
      allocations[index].push({ name: bankSources[0]?.name || 'Banco', amount });
      remaining[index] -= amount;
      bankRemaining -= amount;
    }
  });

  const allocateAcrossRemaining = (sourceName, requestedAmount) => {
    let amountLeft = Math.min(Math.max(0, toNum(requestedAmount)), remaining.reduce((sum, amount) => sum + amount, 0));
    const capacity = remaining.reduce((sum, amount) => sum + amount, 0);
    if (amountLeft <= 0 || capacity <= 0) return;
    remaining.forEach((gap, index) => {
      if (gap <= 0 || amountLeft <= 0) return;
      const share = index === remaining.length - 1 ? amountLeft : Math.min(gap, requestedAmount * gap / capacity);
      const amount = Math.min(gap, amountLeft, share);
      if (amount > 0) {
        allocations[index].push({ name: sourceName, amount });
        remaining[index] -= amount;
        amountLeft -= amount;
      }
    });
    if (amountLeft > 0.000001) {
      for (let index = 0; index < remaining.length && amountLeft > 0.000001; index += 1) {
        const amount = Math.min(remaining[index], amountLeft);
        if (amount <= 0) continue;
        const existing = allocations[index].find(item => item.name === sourceName);
        if (existing) existing.amount += amount;
        else allocations[index].push({ name: sourceName, amount });
        remaining[index] -= amount;
        amountLeft -= amount;
      }
    }
  };

  if (bankRemaining > 0) allocateAcrossRemaining(bankSources[0]?.name || 'Banco', bankRemaining);
  otherSources.forEach(source => allocateAcrossRemaining(source.name || 'Otra fuente', source.amount));
  return safeUses.map((use, index) => ({ ...use, fundingSources: allocations[index] }));
}

function parseFinancePhaseWorkbook(workbook, phase) {
  const errors = [];
  const warnings = [];
  const linesSheet = workbook.getWorksheet('Líneas bancarias') || workbook.worksheets.find(ws => normalizeFinanceExcelLabel(ws.name) === 'lineas bancarias');
  const movementsSheet = workbook.getWorksheet('Movimientos') || workbook.worksheets.find(ws => normalizeFinanceExcelLabel(ws.name) === 'movimientos');
  if (!linesSheet) errors.push('Falta la hoja “Líneas bancarias”.');
  if (!movementsSheet) errors.push('Falta la hoja “Movimientos”.');
  if (errors.length) return { errors, warnings, lines: [], movements: [] };

  validateFinanceExcelHeaders(linesSheet, FINANCE_LINE_IMPORT_HEADERS, errors, warnings, [1]);
  validateFinanceExcelHeaders(movementsSheet, FINANCE_MOVEMENT_IMPORT_HEADERS, errors, warnings, [1, 3]);
  const useSourcesSheet = workbook.getWorksheet('Usos y fuentes')
    || workbook.worksheets.find(ws => normalizeFinanceExcelLabel(ws.name) === 'usos y fuentes');
  const customerPaymentsSheet = workbook.getWorksheet('Abonos clientes')
    || workbook.worksheets.find(ws => normalizeFinanceExcelLabel(ws.name) === 'abonos clientes');
  if (useSourcesSheet) validateFinanceExcelHeaders(useSourcesSheet, FINANCE_USE_SOURCE_IMPORT_HEADERS, errors, warnings);
  if (customerPaymentsSheet) validateFinanceExcelHeaders(customerPaymentsSheet, FINANCE_CUSTOMER_PAYMENT_IMPORT_HEADERS, errors, warnings);
  if (errors.length) return { errors, warnings, lines: [], movements: [] };

  const phaseKey = normalizedFinanceName(phase?.name || '');
  const lines = [];
  const lineKeys = new Set();
  for (let rowNumber = 6; rowNumber <= linesSheet.rowCount; rowNumber += 1) {
    const row = linesSheet.getRow(rowNumber);
    const phaseName = financeExcelText(row.getCell(1));
    const lineName = financeExcelText(row.getCell(2));
    if (!phaseName && !lineName) continue;
    if (normalizeFinanceExcelLabel(phaseName) === 'total') continue;
    if (!lineName) { warnings.push(`Líneas bancarias, fila ${rowNumber}: se omitió porque falta el nombre de la línea.`); continue; }
    if (phaseName && normalizedFinanceName(phaseName) !== phaseKey) warnings.push(`Líneas bancarias, fila ${rowNumber}: se importó en “${phase.name}” aunque el archivo indica “${phaseName}”.`);
    const lineKey = normalizedFinanceName(lineName);
    if (lineKeys.has(lineKey)) { warnings.push(`Líneas bancarias, fila ${rowNumber}: se omitió la línea duplicada “${lineName}”.`); continue; }
    lineKeys.add(lineKey);
    const lineWarnings = [];
    lines.push({
      rowNumber,
      key: lineKey,
      name: lineName,
      approvedAmount: financeExcelNumber(row.getCell(3), { sheet: 'Líneas bancarias', row: rowNumber, column: 'Aprobado', errors: lineWarnings }),
      notes: financeExcelText(row.getCell(14))
    });
    if (lineWarnings.length) warnings.push(...lineWarnings.map(message => `${message} Se usó 0.`));
  }
  if (!lines.length) errors.push('La hoja “Líneas bancarias” no contiene ninguna línea para importar.');

  const movements = [];
  const fileFingerprints = new Set();
  for (let rowNumber = 6; rowNumber <= movementsSheet.rowCount; rowNumber += 1) {
    const row = movementsSheet.getRow(rowNumber);
    const phaseName = financeExcelText(row.getCell(1));
    const lineName = financeExcelText(row.getCell(2));
    if (!phaseName && !lineName && !financeExcelText(row.getCell(4))) continue;
    if (normalizeFinanceExcelLabel(phaseName) === 'total') continue;
    if (phaseName && normalizedFinanceName(phaseName) !== phaseKey) warnings.push(`Movimientos, fila ${rowNumber}: se importó en “${phase.name}” aunque el archivo indica “${phaseName}”.`);
    const lineKey = normalizedFinanceName(lineName);
    if (!lineKeys.has(lineKey)) { warnings.push(`Movimientos, fila ${rowNumber}: se omitió porque la línea “${lineName || 'vacía'}” no existe en “Líneas bancarias”.`); continue; }
    const entryType = financeMovementImportType(financeExcelText(row.getCell(4)));
    if (!entryType) { warnings.push(`Movimientos, fila ${rowNumber}: se omitió porque el tipo de movimiento no se reconoce.`); continue; }

    const movementWarnings = [];
    const bankAmount = financeExcelNumber(row.getCell(8), { sheet: 'Movimientos', row: rowNumber, column: 'Desembolso banco', errors: movementWarnings });
    const promoterAmount = financeExcelNumber(row.getCell(9), { sheet: 'Movimientos', row: rowNumber, column: 'Aporte promotor', errors: movementWarnings });
    const pendingAmount = financeExcelNumber(row.getCell(10), { sheet: 'Movimientos', row: rowNumber, column: 'Importe pendiente', errors: movementWarnings });
    const amortizedAmount = financeExcelNumber(row.getCell(11), { sheet: 'Movimientos', row: rowNumber, column: 'Amortización', errors: movementWarnings });
    const interestAmount = financeExcelNumber(row.getCell(12), { sheet: 'Movimientos', row: rowNumber, column: 'Interés pagado', errors: movementWarnings });
    const fundingLabel = normalizeFinanceExcelLabel(financeExcelText(row.getCell(5)));
    let fundingParty = fundingLabel === 'promotor' ? 'promoter' : fundingLabel === 'mixto' ? 'mixed' : 'bank';
    if (entryType === 'disbursement') {
      if (fundingParty === 'mixed' && (!bankAmount || !promoterAmount)) {
        fundingParty = promoterAmount > 0 ? 'promoter' : 'bank';
        movementWarnings.push(`Movimientos, fila ${rowNumber}: el aportante se ajustó porque el desembolso mixto estaba incompleto.`);
      } else if (fundingParty === 'promoter' && !promoterAmount && bankAmount > 0) {
        fundingParty = 'bank';
        movementWarnings.push(`Movimientos, fila ${rowNumber}: el aportante se ajustó a Banco según el importe disponible.`);
      } else if (fundingParty === 'bank' && !bankAmount && promoterAmount > 0) {
        fundingParty = 'promoter';
        movementWarnings.push(`Movimientos, fila ${rowNumber}: el aportante se ajustó a Promotor según el importe disponible.`);
      }
    }
    const status = normalizeFinanceExcelLabel(financeExcelText(row.getCell(15)));
    const isPending = pendingAmount > 0 || ['pendiente', 'preparado', 'solicitado', 'devuelto'].includes(status);
    const workflowStatus = status === 'solicitado' ? 'requested' : status === 'devuelto' ? 'returned' : isPending ? 'prepared' : 'disbursed';
    const inspectionId = financeExcelText(row.getCell(19));
    const validInspectionId = inspectionId && mongoose.isValidObjectId(inspectionId) ? inspectionId : null;
    if (inspectionId && !validInspectionId) movementWarnings.push(`Movimientos, fila ${rowNumber}: se ignoró el identificador no válido de “Informe avalúo”.`);

    let disbursementAmount = 0;
    let promoterContributionAmount = 0;
    if (entryType === 'disbursement') {
      if (fundingParty === 'promoter') disbursementAmount = promoterAmount || pendingAmount;
      else {
        disbursementAmount = bankAmount || pendingAmount;
        promoterContributionAmount = fundingParty === 'mixed' ? promoterAmount : 0;
      }
      if (!disbursementAmount && !promoterContributionAmount) { warnings.push(`Movimientos, fila ${rowNumber}: se omitió porque el desembolso no tiene importe.`); continue; }
    } else if (entryType === 'manual_amortization' && !amortizedAmount) {
      warnings.push(`Movimientos, fila ${rowNumber}: se omitió porque la amortización manual no tiene importe.`); continue;
    } else if (entryType === 'interest_payment' && !interestAmount) {
      warnings.push(`Movimientos, fila ${rowNumber}: se omitió porque el interés pagado no tiene importe.`); continue;
    }

    const movementDate = financeExcelDate(row.getCell(6), { sheet: 'Movimientos', row: rowNumber, column: 'Fecha', errors: movementWarnings });
    const entry = {
      entryType,
      paymentStatus: entryType === 'disbursement' ? (isPending ? 'pending' : 'paid') : 'legacy',
      workflowStatus: entryType === 'disbursement' ? workflowStatus : 'prepared',
      advanceAccountNumber: Math.max(0, Math.trunc(financeExcelNumber(row.getCell(3), { sheet: 'Movimientos', row: rowNumber, column: 'Cuenta avance', errors: movementWarnings }))) || null,
      fundingParty,
      promoterContributionAmount,
      promoterContributionStatus: promoterContributionAmount > 0 && !isPending ? 'contributed' : 'pending',
      requestedAt: financeExcelDate(row.getCell(16), { sheet: 'Movimientos', row: rowNumber, column: 'Solicitud', errors: movementWarnings }),
      disbursedByRole: financeExcelText(row.getCell(17)),
      transferReference: financeExcelText(row.getCell(18)),
      movementDate: entryType === 'disbursement' ? null : movementDate,
      disbursementDate: entryType === 'disbursement' ? movementDate : null,
      loanNumber: financeExcelText(row.getCell(7)),
      disbursementAmount,
      maturityDate: financeExcelDate(row.getCell(14), { sheet: 'Movimientos', row: rowNumber, column: 'Vencimiento', errors: movementWarnings }),
      amortizedAmount,
      interestAmount,
      inspectionId: validInspectionId,
      notes: financeExcelText(row.getCell(21)) || financeExcelText(row.getCell(20))
    };
    const fingerprint = `${lineKey}|${financeImportedMovementFingerprint(entry)}`;
    if (fileFingerprints.has(fingerprint)) { warnings.push(`Movimientos, fila ${rowNumber}: se omitió un movimiento duplicado.`); continue; }
    fileFingerprints.add(fingerprint);
    warnings.push(...movementWarnings);
    movements.push({
      rowNumber,
      lineKey,
      entry,
      saleUnitLabel: entryType === 'sale_amortization' ? financeExcelText(row.getCell(20)) : ''
    });
  }

  let phaseSummary = null;
  if (useSourcesSheet) {
    const groups = { uses: [], sources: [] };
    const seen = new Set();
    for (let rowNumber = 6; rowNumber <= useSourcesSheet.rowCount; rowNumber += 1) {
      const row = useSourcesSheet.getRow(rowNumber);
      const phaseName = financeExcelText(row.getCell(1));
      const groupLabel = normalizeFinanceExcelLabel(financeExcelText(row.getCell(2)));
      const name = financeExcelText(row.getCell(3));
      if (!phaseName && !groupLabel && !name) continue;
      if (/^total\b/.test(normalizeFinanceExcelLabel(name))) continue;
      if (phaseName && normalizedFinanceName(phaseName) !== phaseKey) warnings.push(`Usos y fuentes, fila ${rowNumber}: se importó en “${phase.name}” aunque el archivo indica “${phaseName}”.`);
      const group = groupLabel === 'usos' ? 'uses' : groupLabel === 'fuentes' ? 'sources' : '';
      if (!group) { warnings.push(`Usos y fuentes, fila ${rowNumber}: se omitió porque el grupo no es “Usos” ni “Fuentes”.`); continue; }
      if (!name) { warnings.push(`Usos y fuentes, fila ${rowNumber}: se omitió porque falta el nombre de la partida.`); continue; }
      const key = `${group}:${normalizedFinanceName(name)}`;
      if (seen.has(key)) { warnings.push(`Usos y fuentes, fila ${rowNumber}: se omitió la partida duplicada “${name}”.`); continue; }
      seen.add(key);
      groups[group].push({
        name,
        plan: financeExcelNumber(row.getCell(4), { sheet: 'Usos y fuentes', row: rowNumber, column: 'Plan', errors: warnings }),
        real: financeExcelNumber(row.getCell(5), { sheet: 'Usos y fuentes', row: rowNumber, column: 'Real', errors: warnings })
      });
    }
    if (!groups.uses.length || !groups.sources.length) warnings.push('No se importaron “Usos y fuentes” porque falta al menos un uso o una fuente.');
    else phaseSummary = {
      planUses: groups.uses.map(item => ({ name: item.name, amount: item.plan })),
      uses: groups.uses.map(item => ({ name: item.name, amount: item.real })),
      planSources: groups.sources.map(item => ({ name: item.name, amount: item.plan })),
      sources: groups.sources.map(item => ({ name: item.name, amount: item.real }))
    };
  }

  const customerPayments = [];
  const customerPaymentWarnings = [];
  if (customerPaymentsSheet) {
    const fileFingerprints = new Set();
    for (let rowNumber = 6; rowNumber <= customerPaymentsSheet.rowCount; rowNumber += 1) {
      const row = customerPaymentsSheet.getRow(rowNumber);
      const unitLabel = financeExcelText(row.getCell(1));
      const rawDate = financeExcelCellValue(row.getCell(5));
      const rawReceipt = financeExcelText(row.getCell(6));
      const rawAmount = financeExcelCellValue(row.getCell(7));
      const hasPaymentData = (
        (rawDate !== '' && rawDate !== null && rawDate !== undefined)
        || rawReceipt
        || (rawAmount !== '' && rawAmount !== null && rawAmount !== undefined && Number(rawAmount) !== 0)
      );
      // El exportador incluye una fila resumen cuando una cuenta todavía no
      // tiene pagos. No es un abono importable y se ignora intencionadamente.
      if (!hasPaymentData) continue;
      if (!unitLabel) {
        customerPaymentWarnings.push(`Abonos clientes, fila ${rowNumber}: se omitió porque falta la unidad.`);
        continue;
      }
      const dateErrors = [];
      const paymentDate = financeExcelDate(row.getCell(5), { sheet: 'Abonos clientes', row: rowNumber, column: 'Fecha del abono', errors: dateErrors });
      const amountErrors = [];
      const amount = financeExcelNumber(row.getCell(7), { sheet: 'Abonos clientes', row: rowNumber, column: 'Importe pago', errors: amountErrors, required: true });
      if (!paymentDate) {
        customerPaymentWarnings.push(`Abonos clientes, fila ${rowNumber}: se omitió porque “Fecha del abono” no contiene una fecha válida.`);
        continue;
      }
      if (amount <= 0) { customerPaymentWarnings.push(...amountErrors.map(message => `${message} Se omitió la fila.`)); continue; }
      const payment = {
        rowNumber,
        unitLabel,
        clientName: financeExcelText(row.getCell(2)),
        concept: financeExcelText(row.getCell(3)) || 'Abono del cliente',
        recipient: financeCustomerPaymentRecipient(financeExcelText(row.getCell(4))),
        paymentDate,
        // Venta exige recibo. La referencia generada es determinista para que
        // reimportar el mismo archivo no duplique las filas sin recibo.
        receiptNumber: rawReceipt || `IMPORTADO-FILA-${rowNumber}`,
        amount,
        agreedAmount: financeExcelNumber(row.getCell(8), { sheet: 'Abonos clientes', row: rowNumber, column: 'Total acordado', errors: customerPaymentWarnings })
      };
      const fingerprint = `${normalizeFinanceUnitAlias(unitLabel)}|${financeImportedCustomerPaymentFingerprint(payment)}`;
      if (fileFingerprints.has(fingerprint)) {
        customerPaymentWarnings.push(`Abonos clientes, fila ${rowNumber}: se omitió un abono duplicado dentro del archivo.`);
        continue;
      }
      fileFingerprints.add(fingerprint);
      customerPayments.push(payment);
    }
  }

  return { errors, warnings: [...warnings, ...customerPaymentWarnings], lines, movements, phaseSummary, customerPayments, customerPaymentWarnings };
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

function financeUnitDisplayName(unit = {}) {
  const lot = String(unit?.lote || '').trim();
  const hasImportedLocation = [unit?.etapa, unit?.torre, unit?.nivel]
    .some(value => String(value || '').trim());
  if (hasImportedLocation && lot) return lot;
  return [unit?.manzana, lot].map(value => String(value || '').trim()).filter(Boolean).join('-')
    || unit?.modelo || 'Unidad';
}

async function getFinanceCommercialUnits(projectId, tenantKey) {
  const unitFilter = { projectId, deletedAt: null };
  const ventaFilter = { projectId };
  if (tenantKey) {
    unitFilter.tenantKey = tenantKey;
    ventaFilter.tenantKey = tenantKey;
  }

  const [units, ventas] = await Promise.all([
    Unit.find(unitFilter).select('_id etapa torre nivel manzana lote estado modelo recamaras banos areaAbierta areaCerrada').sort({ manzana: 1, lote: 1 }).lean(),
    Venta.find(ventaFilter).select('unitId clienteNombre primerNombre segundoNombre primerApellido segundoApellido apellidoCasada banco valor montoFinanciamientoCPP precioVenta numCPP estatusCPP statusBanco customerPaymentAccounts customerPaymentsVersion').lean()
  ]);

  const ventasByUnit = new Map((ventas || []).map(v => [String(v.unitId), v]));
  return (units || []).map(u => {
    const venta = ventasByUnit.get(String(u._id)) || {};
    const customerPayments = customerPaymentSummary(venta);
    const initialPayment = Math.max(0, toNum(venta.precioVenta) - toNum(venta.montoFinanciamientoCPP || venta.valor));
    const displayName = financeUnitDisplayName(u);
    const legacyLot = [u.manzana, u.lote].map(value => String(value || '').trim()).filter(Boolean).join('-');
    return {
      unitId: String(u._id),
      lot: displayName,
      unitLabel: displayName,
      rawLot: String(u.lote || '').trim(),
      legacyLot,
      modelName: u.modelo || '',
      bedrooms: toNum(u.recamaras),
      bathrooms: toNum(u.banos),
      openAreaM2: toNum(u.areaAbierta),
      closedAreaM2: toNum(u.areaCerrada),
      commercialStatus: u.estado || '',
      clientName: commercialClientName(venta),
      buyerBank: venta.banco || '',
      cppAmount: toNum(venta.montoFinanciamientoCPP || venta.valor),
      initialPayment,
      salePrice: toNum(venta.precioVenta),
      financeBaseAmount: toNum(venta.montoFinanciamientoCPP || venta.valor),
      financeBaseAmountWithInitial: toNum(venta.montoFinanciamientoCPP || venta.valor) + initialPayment,
      cppNumber: venta.numCPP || '',
      cppStatus: venta.estatusCPP || venta.statusBanco || '',
      customerPaymentAccounts: customerPayments.accounts,
      customerPaymentTotals: customerPayments.totals,
      customerClearanceStatus: customerPayments.clearanceStatus,
      customerPaymentsVersion: toNum(venta.customerPaymentsVersion),
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

    await getOrCreate(projectId, projectRaw.tenantKey);
    const reconciliation = await reconcileProjectStages({ projectId, tenantKey: projectRaw.tenantKey });
    const doc = reconciliation.finance;
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
    const requestedPhaseId = mongoose.isValidObjectId(req.body?.phaseId) ? String(req.body.phaseId) : '';
    const scopedPhaseLines = Array.isArray(req.body?.phaseLoanLines) ? req.body.phaseLoanLines : null;
    // El cliente del modal edita una unica fase. Mezclamos esa fase con el
    // estado mas reciente del servidor para impedir que una copia antigua de
    // otras fases borre sus lineas o movimientos.
    const rawLines = requestedPhaseId && scopedPhaseLines
      ? [
          ...(doc.loanLines || [])
            .filter(line => String(line?.phaseId || '') !== requestedPhaseId)
            .map(line => line?.toObject ? line.toObject() : line),
          ...scopedPhaseLines.map(line => ({ ...line, phaseId: requestedPhaseId }))
        ]
      : (Array.isArray(req.body?.loanLines) ? req.body.loanLines : []);
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

router.post('/projects/:projectId/finance/import', financeExcelUpload, async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase().trim();
    if (!req.file?.buffer) return res.status(400).json({ error: 'Selecciona un archivo Excel .xlsx.' });
    const phaseId = String(req.body?.phaseId || '');
    if (!mongoose.isValidObjectId(phaseId)) return res.status(400).json({ error: 'La fase seleccionada no es válida.' });

    const project = await loadTenantProject(req, res);
    if (!project) return;
    const regularImportRole = ['admin', 'financiero', 'gerencia', 'socios'].includes(role);
    const isInitialCreatorImport = ['bank', 'promoter'].includes(role)
      && String(project.createdBy || '') === String(req.user?.userId || req.user?._id || req.user?.id || '')
      && String(project.publishStatus || '') === 'pending';
    if (!regularImportRole && !isInitialCreatorImport) {
      return res.status(403).json({ error: 'No tienes permiso para importar líneas y movimientos financieros.' });
    }
    const doc = await getOrCreate(req.params.projectId, project.tenantKey);
    const phase = doc.phases.id(phaseId);
    if (!phase) return res.status(404).json({ error: 'La fase seleccionada no existe.' });

    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(req.file.buffer);
    } catch (_error) {
      return res.status(400).json({ error: 'El archivo no es un Excel .xlsx válido o está dañado.' });
    }
    const parsed = parseFinancePhaseWorkbook(workbook, phase);
    if (parsed.errors.length) {
      return res.status(400).json({ error: 'El Excel contiene errores y no se ha importado ningún dato.', errors: parsed.errors });
    }
    const importWarnings = [...(parsed.warnings || [])];

    const currentPhaseLines = (doc.loanLines || []).filter(line => String(line?.phaseId || '') === phaseId);
    const existingGroups = new Map();
    currentPhaseLines.forEach(line => {
      const key = normalizedFinanceName(line?.name || '');
      if (!existingGroups.has(key)) existingGroups.set(key, []);
      existingGroups.get(key).push(line);
    });
    const ambiguous = parsed.lines.filter(line => (existingGroups.get(line.key) || []).length > 1);
    if (ambiguous.length) {
      return res.status(409).json({
        error: 'Hay nombres de línea duplicados en la fase y no se puede determinar dónde importar los movimientos.',
        errors: ambiguous.map(line => `La línea “${line.name}” aparece varias veces en la fase.`)
      });
    }

    let createdLines = 0;
    let updatedLines = 0;
    let importedMovements = 0;
    let importedSaleAmortizations = 0;
    let importedCustomerPayments = 0;
    let skippedCustomerPayments = 0;
    const skippedInvalidCustomerPayments = (parsed.customerPaymentWarnings || []).length;
    const replacedMovements = currentPhaseLines.reduce((sum, line) => sum + (line?.entries?.length || 0), 0);
    const importedByKey = new Map();
    const previousEntriesByLine = new Map();
    for (const importedLine of parsed.lines) {
      const existing = (existingGroups.get(importedLine.key) || [])[0];
      const target = existing?.toObject ? existing.toObject() : existing ? { ...existing } : {
        _id: new mongoose.Types.ObjectId(),
        phaseId: phase._id,
        phaseName: phase.name || '',
        approvedAmountMode: 'manual',
        name: importedLine.name,
        entries: []
      };
      previousEntriesByLine.set(importedLine.key, Array.isArray(target.entries) ? target.entries : []);
      target.phaseId = phase._id;
      target.phaseName = phase.name || '';
      target.name = importedLine.name;
      target.approvedAmount = importedLine.approvedAmount;
      target.notes = importedLine.notes;
      // El Excel reemplaza la fase. Solo conservamos la trazabilidad interna
      // de filas que podamos reconocer como el mismo movimiento.
      target.entries = [];
      importedByKey.set(importedLine.key, target);
      if (existing) updatedLines += 1;
      else createdLines += 1;
    }

    const saleMovements = [];
    const resolvedAmbiguousUnits = new Set();
    for (const movement of parsed.movements) {
      const target = importedByKey.get(movement.lineKey);
      if (!target) continue;
      if (movement.entry.entryType === 'sale_amortization') {
        saleMovements.push(movement);
        continue;
      }
      const fingerprint = financeImportedMovementFingerprint(movement.entry);
      const previousEntries = previousEntriesByLine.get(movement.lineKey) || [];
      const previousIndex = previousEntries.findIndex(entry => financeImportedMovementFingerprint(entry) === fingerprint);
      const previous = previousIndex >= 0 ? previousEntries.splice(previousIndex, 1)[0] : null;
      target.entries.push(previous ? { ...previous, ...movement.entry, _id: previous._id } : movement.entry);
      importedMovements += 1;
    }

    const commercialUnits = await getFinanceCommercialUnits(req.params.projectId, project.tenantKey);
    const customerPaymentUpdates = new Map();
    if ((parsed.customerPayments || []).length) {
      const paymentUnitCandidates = new Map();
      const addPaymentUnitAlias = (alias, item) => {
        const key = normalizeFinanceUnitAlias(alias);
        if (!key) return;
        if (!paymentUnitCandidates.has(key)) paymentUnitCandidates.set(key, []);
        if (!paymentUnitCandidates.get(key).includes(item)) paymentUnitCandidates.get(key).push(item);
      };
      commercialUnits.forEach(unit => {
        addPaymentUnitAlias(unit.lot, unit);
        addPaymentUnitAlias(unit.unitLabel, unit);
        addPaymentUnitAlias(unit.rawLot, unit);
        addPaymentUnitAlias(unit.legacyLot, unit);
      });
      const sales = await Venta.find({
        projectId: project._id,
        tenantKey: project.tenantKey,
        deletedAt: null
      }).select('_id unitId customerPaymentAccounts customerPaymentsVersion').lean();
      const salesByUnit = new Map(sales.map(sale => [String(sale.unitId || ''), sale]));
      for (const importedPayment of parsed.customerPayments) {
        const matches = financeUnitCandidatesByAlias(paymentUnitCandidates, importedPayment.unitLabel);
        if (!matches.length) {
          importWarnings.push(`Abonos clientes, fila ${importedPayment.rowNumber}: se omitió porque no se encontró la unidad “${importedPayment.unitLabel}”.`);
          continue;
        }
        if (matches.length > 1) {
          importWarnings.push(`Abonos clientes, fila ${importedPayment.rowNumber}: se omitió porque la unidad “${importedPayment.unitLabel}” coincide con varias unidades.`);
          continue;
        }
        const sale = salesByUnit.get(String(matches[0].unitId || ''));
        if (!sale) {
          importWarnings.push(`Abonos clientes, fila ${importedPayment.rowNumber}: se omitió porque la unidad “${importedPayment.unitLabel}” no tiene expediente comercial.`);
          continue;
        }
        let update = customerPaymentUpdates.get(String(sale._id));
        if (!update) {
          const accounts = (sale.customerPaymentAccounts || []).map(account => ({
            ...(account?.toObject ? account.toObject() : account),
            payments: (account?.payments || []).map(payment => payment?.toObject ? payment.toObject() : { ...payment })
          }));
          let account = accounts.find(item => item.source === 'sale_gap');
          if (!account) {
            account = {
              source: 'sale_gap',
              concept: 'Abono del cliente',
              agreedAmount: 0,
              recipient: 'promoter',
              requiredForClearance: true,
              payments: []
            };
            accounts.unshift(account);
          }
          update = { sale, accounts, account };
          customerPaymentUpdates.set(String(sale._id), update);
        }
        const fingerprint = financeImportedCustomerPaymentFingerprint(importedPayment);
        const alreadyExists = (update.account.payments || []).some(payment =>
          financeImportedCustomerPaymentFingerprint(payment) === fingerprint
        );
        if (alreadyExists) {
          skippedCustomerPayments += 1;
          continue;
        }
        update.account.payments = update.account.payments || [];
        update.account.payments.push({
          paymentDate: importedPayment.paymentDate,
          recipient: importedPayment.recipient,
          receiptNumber: importedPayment.receiptNumber,
          amount: importedPayment.amount
        });
        importedCustomerPayments += 1;
      }
    }
    const unitAmortizations = (doc.unitAmortizations || []).map(item => item?.toObject ? item.toObject() : { ...item });
    const commercialById = new Map(commercialUnits.map(unit => [String(unit.unitId || ''), unit]));
    const unitCandidates = new Map();
    const addUnitAlias = (alias, item) => {
      const key = normalizeFinanceUnitAlias(alias);
      if (!key) return;
      if (!unitCandidates.has(key)) unitCandidates.set(key, []);
      if (!unitCandidates.get(key).includes(item)) unitCandidates.get(key).push(item);
    };
    for (const item of unitAmortizations) {
      const commercial = commercialById.get(String(item.unitId || '')) || {};
      addUnitAlias(item.lot, item);
      addUnitAlias(commercial.lot, item);
      addUnitAlias(commercial.unitLabel, item);
      addUnitAlias(commercial.rawLot, item);
      addUnitAlias(commercial.legacyLot, item);
    }
    for (const commercial of commercialUnits) {
      let item = unitAmortizations.find(current => String(current.unitId || '') === String(commercial.unitId || ''));
      if (!item) {
        const aliases = new Set([commercial.lot, commercial.unitLabel, commercial.rawLot, commercial.legacyLot].map(normalizeFinanceUnitAlias).filter(Boolean));
        item = unitAmortizations.find(current => aliases.has(normalizeFinanceUnitAlias(current.lot || '')));
      }
      if (!item) {
        // Marcador ligero: solo creamos un registro financiero si el Excel
        // contiene realmente una amortización para esta unidad.
        item = { __commercialSource: commercial };
      }
      addUnitAlias(commercial.lot, item);
      addUnitAlias(commercial.unitLabel, item);
      addUnitAlias(commercial.rawLot, item);
      addUnitAlias(commercial.legacyLot, item);
    }

    const replacedPhaseLineIds = new Set(currentPhaseLines.map(line => String(line?._id || '')).filter(Boolean));
    const importedLineNames = new Set(parsed.lines.map(line => line.key));
    unitAmortizations.forEach(item => {
      item.allocations = (item.allocations || []).filter(allocation => {
        const allocationLineId = String(allocation?.loanLineId || '');
        if (allocationLineId) return !replacedPhaseLineIds.has(allocationLineId);
        return !importedLineNames.has(normalizedFinanceName(allocation?.loanLineName || ''));
      });
    });

    for (const movement of saleMovements) {
      const rawUnitLabel = String(movement.saleUnitLabel || '').split('·')[0].trim();
      const rawMatches = financeUnitCandidatesByAlias(unitCandidates, rawUnitLabel);
      // Una unidad puede aparecer dos veces en memoria: como ficha comercial y
      // como control financiero histórico. Las agrupamos por unitId para que
      // ambas representaciones cuenten como un único candidato real.
      const matches = uniqueFinanceUnitCandidates(rawMatches, rawUnitLabel);
      if (!rawUnitLabel) {
        importWarnings.push(`Movimientos, fila ${movement.rowNumber}: se omitió la amortización por venta porque falta “Detalle / unidad”.`);
        continue;
      }
      if (!matches.length) {
        importWarnings.push(`Movimientos, fila ${movement.rowNumber}: se omitió la amortización por venta porque no se encontró la unidad “${rawUnitLabel}”.`);
        continue;
      }
      const targetLine = importedByKey.get(movement.lineKey);
      const unitItem = selectFinanceUnitCandidate(matches);
      if (matches.length > 1) resolvedAmbiguousUnits.add(rawUnitLabel);
      if (unitItem.__commercialSource) {
        const commercial = unitItem.__commercialSource;
        Object.assign(unitItem, {
          _id: new mongoose.Types.ObjectId(), unitId: commercial.unitId || null,
          clientName: commercial.clientName || '', lot: commercial.lot || commercial.unitLabel || '',
          buyerBank: commercial.buyerBank || '', checkAmount: commercial.cppAmount || 0,
          checkAmountSource: 'cpp', allocations: [], promoterAmount: 0, notes: ''
        });
        delete unitItem.__commercialSource;
        unitAmortizations.push(unitItem);
      }
      const existingAllocation = (unitItem.allocations || []).find(allocation => String(allocation.loanLineId || '') === String(targetLine._id));
      if (existingAllocation) existingAllocation.amount = toNum(existingAllocation.amount) + toNum(movement.entry.amortizedAmount);
      else {
        unitItem.allocations = unitItem.allocations || [];
        unitItem.allocations.push({ loanLineId: targetLine._id, loanLineName: targetLine.name, amount: toNum(movement.entry.amortizedAmount) });
      }
      importedSaleAmortizations += 1;
    }
    const preservedLines = (doc.loanLines || [])
      .filter(line => String(line?.phaseId || '') !== phaseId)
      .map(line => line?.toObject ? line.toObject() : line);
    const rawLines = [...preservedLines, ...importedByKey.values()];
    if (parsed.phaseSummary) {
      const importedLines = [...importedByKey.values()];
      phase.planSources = parsed.phaseSummary.planSources;
      phase.sources = parsed.phaseSummary.sources;
      phase.planUses = financeImportedUsesWithFunding(parsed.phaseSummary.planUses, parsed.phaseSummary.planSources, importedLines);
      phase.uses = financeImportedUsesWithFunding(parsed.phaseSummary.uses, parsed.phaseSummary.sources, importedLines);
    }
    const lines = assignAdvanceAccountNumbers(mergeProtectedLoanWorkflow(rawLines, doc), doc);
    validateLoanLineLimits(doc, lines);
    validateLoanFunding(lines);
    await validateLoanLineReports({ req, project, rawLines: lines, currentDoc: doc });
    doc.loanLines = lines.map(normalizeLoanLine);
    doc.unitAmortizations = unitAmortizations.map(normalizeUnitAmortization);
    if (customerPaymentUpdates.size) {
      await Venta.bulkWrite([...customerPaymentUpdates.values()].map(({ sale, accounts }) => ({
        updateOne: {
          filter: { _id: sale._id, projectId: project._id, tenantKey: project.tenantKey, deletedAt: null },
          update: { $set: { customerPaymentAccounts: accounts }, $inc: { customerPaymentsVersion: 1 } }
        }
      })), { ordered: true });
    }
    await doc.save();

    await audit(req, 'finance.loan_lines_imported', {
      targetType: 'project', targetId: project._id, projectId: project._id,
      message: `Excel financiero importado en ${phase.name || 'fase'}`,
      metadata: { phaseId, createdLines, updatedLines, importedMovements, importedSaleAmortizations, importedCustomerPayments, skippedCustomerPayments, skippedInvalidCustomerPayments, warnings: importWarnings.length, replacedMovements, resolvedAmbiguousUnits: resolvedAmbiguousUnits.size, importedPhaseSummary: !!parsed.phaseSummary }
    });
    const control = sharedBuildFinanceControlSummary(doc, project || {});
    res.json({ ok: true, createdLines, updatedLines, importedMovements, importedSaleAmortizations, importedCustomerPayments, skippedCustomerPayments, skippedInvalidCustomerPayments, warnings: importWarnings, replacedMovements, resolvedAmbiguousUnits: resolvedAmbiguousUnits.size, importedPhaseSummary: !!parsed.phaseSummary, financeControl: control });
  } catch (err) {
    console.error('POST finance import error', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'No se pudo importar el Excel financiero.' });
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

    const credential = String(req.body?.credential || req.body?.password || req.body?.pin || '').trim();
    if (!credential) return res.status(400).json({ error: 'Introduce tu contraseña o el PIN de eliminación para confirmar.' });

    const actorId = req.user?.userId || req.user?._id || req.user?.id || null;
    const actor = mongoose.isValidObjectId(actorId) ? await User.findById(actorId).select('password email role') : null;
    const expectedPin = String(process.env.FINANCE_DELETE_PIN || process.env.PROCESS_DELETE_PIN || '2580').trim();
    const validAccountPassword = Boolean(actor && verifyPassword(credential, actor.password));
    const validDeletePin = Boolean(expectedPin && credential === expectedPin);
    if (!validAccountPassword && !validDeletePin) {
      return res.status(403).json({ error: 'La contraseña o el PIN no son correctos. No se eliminó la partida.' });
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
        confirmationMethod: validAccountPassword ? 'account_password' : 'delete_pin',
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
      // La solicitud conserva la foto de los requisitos revisados y, a
      // continuación, abre el nuevo ciclo de Cuenta Avance en el proyecto.
      const accountAdvanceRequirement = (phase?.requirements || []).find(item => Number(item?.number) === 28);
      if (accountAdvanceRequirement) {
        accountAdvanceRequirement.status = 'PENDIENTE';
        accountAdvanceRequirement.completedAt = null;
        accountAdvanceRequirement.completedBy = null;
        accountAdvanceRequirement.completedByRole = '';
        accountAdvanceRequirement.structuredData = {
          kind: 'accountAdvance',
          requestId: String(entry._id),
          advanceAccountNumber: Number(entry.advanceAccountNumber || 0) || null,
          requestedAt: now,
          requestDocumentId: String(requestDocument._id),
          requestDocumentName: String(requestDocument.originalname || 'Carta de solicitud.pdf')
        };
      }
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
      .select('_id reportNumber inspectionDate finalizedAt projectProgressPercent technicalRecommendation sequence accountName revision origin externalReportDocumentId')
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
            url: report.origin === 'external' && report.externalReportDocumentId
              ? `/api/documents/${report.externalReportDocumentId}/download`
              : `/api/projects/${project._id}/finance/inspection-reports/${report._id}/report.pdf`
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
    const assignments = await ProjectAvaluatorAssignment.find(activeAvaluatorAssignmentFilter(req, project))
      .populate('avaluadorId', 'name email')
      .select('_id bankTenantKey avaluadorId')
      .lean();
    const finance = await ProjectFinance.findOne({ project: project._id, tenantKey: project.tenantKey }).lean() || { loanLines: [] };
    if (!assignments.length) return res.json({ hasAssignedAvaluator: false, reports: [], assignments: [], loanLines: [] });
    const reports = await Inspection.find({
      projectId: project._id,
      projectTenantKey: project.tenantKey,
      bankTenantKey: { $in: assignments.map(item => item.bankTenantKey) },
      status: 'finalized',
      supersededByInspectionId: null
    }).populate('avaluadorId', 'name email').sort({ finalizedAt: -1 }).lean();
    const linkedEntries = new Map();
    for (const line of (finance.loanLines || [])) {
      for (const entry of (line.entries || [])) {
        if (!entry.inspectionId) continue;
        linkedEntries.set(String(entry.inspectionId), {
          lineId: String(line._id),
          lineName: String(line.name || 'Linea bancaria'),
          entryId: String(entry._id),
          amount: Number(entry.disbursementAmount || 0),
          status: String(entry.workflowStatus || (entry.paymentStatus === 'paid' ? 'disbursed' : 'prepared'))
        });
      }
    }
    const actorRole = String(req.user?.role || '').toLowerCase();
    res.json({
      hasAssignedAvaluator: true,
      canCreateExternal: ['admin', 'bank', 'tecnico', 'financiero', 'contable'].includes(actorRole),
      assignments: assignments.map(item => ({
        id: String(item._id),
        bankTenantKey: String(item.bankTenantKey || ''),
        avaluadorId: String(item.avaluadorId?._id || item.avaluadorId || ''),
        name: String(item.avaluadorId?.name || ''),
        email: String(item.avaluadorId?.email || '')
      })),
      loanLines: (finance.loanLines || []).map(line => ({
        id: String(line._id),
        name: String(line.name || 'Linea bancaria'),
        phaseName: String(line.phaseName || ''),
        approvedAmount: Number(line.approvedAmount || 0)
      })),
      reports: reports.map(item => ({
        id: String(item._id),
        origin: String(item.origin || 'app'),
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
        reportPath: item.origin === 'external' && item.externalReportDocumentId
          ? `/api/documents/${item.externalReportDocumentId}/download`
          : `/api/projects/${project._id}/finance/inspection-reports/${item._id}/report.pdf`,
        disbursement: linkedEntries.get(String(item._id)) || null
      }))
    });
  } catch (err) {
    res.status(500).json({ error: 'No se pudieron cargar los informes de avalúo.' });
  }
});

router.post('/projects/:projectId/finance/external-inspections', externalInspectionUpload, async (req, res) => {
  const uploadedPath = req.file?.path;
  let documentCreated = false;
  const rejectUpload = (status, error) => {
    if (uploadedPath && fs.existsSync(uploadedPath)) fs.unlink(uploadedPath, () => {});
    return res.status(status).json({ error });
  };
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (!['admin', 'bank', 'tecnico', 'financiero', 'contable'].includes(role)) {
      return rejectUpload(403, 'No tienes permiso para registrar informes externos.');
    }
    const project = await loadTenantProject(req, res);
    if (!project) {
      if (uploadedPath && fs.existsSync(uploadedPath)) fs.unlink(uploadedPath, () => {});
      return;
    }
    if (!req.file) return res.status(400).json({ error: 'Adjunta el informe externo en formato PDF.' });

    const assignments = await ProjectAvaluatorAssignment.find(activeAvaluatorAssignmentFilter(req, project)).lean();
    const assignment = assignments.find(item => String(item.avaluadorId) === String(req.body?.avaluadorId || '')) || assignments[0];
    if (!assignment) return rejectUpload(400, 'El proyecto no tiene un avaluador activo asignado.');

    const requestedSequence = Number(req.body?.sequence || 0);
    const latest = await Inspection.findOne({
      bankTenantKey: assignment.bankTenantKey,
      projectTenantKey: project.tenantKey,
      projectId: project._id,
      deletedAt: null
    }).sort({ sequence: -1 }).select('sequence').lean();
    const sequence = Number.isInteger(requestedSequence) && requestedSequence > 0
      ? requestedSequence
      : Number(latest?.sequence || 0) + 1;
    const duplicate = await Inspection.exists({
      bankTenantKey: assignment.bankTenantKey,
      projectTenantKey: project.tenantKey,
      projectId: project._id,
      sequence,
      revision: 1,
      deletedAt: null
    });
    if (duplicate) return rejectUpload(409, `Ya existe la cuenta n.º ${sequence}.`);

    const progress = Math.max(0, Math.min(100, Number(req.body?.projectProgressPercent || 0)));
    const verdict = ['favorable', 'conditional', 'unfavorable', 'not_assessed'].includes(req.body?.verdict)
      ? req.body.verdict
      : 'not_assessed';
    const inspectionDate = cleanDate(req.body?.inspectionDate) || new Date();
    const actorId = req.user?._id || req.user?.userId || req.user?.id;
    const amount = Math.max(0, Number(req.body?.disbursementAmount || 0));
    let financeForDisbursement = null;
    let lineForDisbursement = null;
    if (req.body?.loanLineId && amount > 0) {
      financeForDisbursement = await getOrCreate(project._id, project.tenantKey);
      lineForDisbursement = financeForDisbursement.loanLines.id(req.body.loanLineId);
      if (!lineForDisbursement) throw Object.assign(new Error('La línea bancaria seleccionada ya no existe.'), { status: 400 });
    }
    const relativePath = path.relative(path.join(__dirname, '..'), req.file.path).replace(/\\/g, '/');
    const document = await Document.create({
      tenantKey: project.tenantKey,
      projectId: project._id,
      folder: 'tecnico',
      subfolder: 'Informes de avaluo',
      originalname: req.file.originalname,
      filename: req.file.filename,
      path: relativePath,
      mimetype: req.file.mimetype,
      size: req.file.size,
      title: `Cuenta n.º ${sequence} - informe externo`,
      category: 'externalInspection',
      uploadedBy: actorId,
      uploaderRole: role,
      visibleToRoles: ['admin', 'bank', 'avaluador', 'tecnico', 'financiero', 'contable']
    });
    documentCreated = true;

    const finalizedAt = new Date();
    const inspection = await Inspection.create({
      origin: 'external',
      externalReportDocumentId: document._id,
      createdOnBehalfBy: actorId,
      createdOnBehalfByRole: role,
      bankTenantKey: assignment.bankTenantKey,
      projectTenantKey: project.tenantKey,
      projectId: project._id,
      avaluadorId: assignment.avaluadorId,
      assignmentId: assignment._id,
      sequence,
      accountName: String(req.body?.accountName || `Cuenta n.º ${sequence}`).trim().slice(0, 160),
      status: 'finalized',
      inspectionDate,
      startedAt: inspectionDate,
      projectProgressPercent: progress,
      generalObservations: String(req.body?.notes || '').trim().slice(0, 10000),
      technicalRecommendation: {
        verdict,
        notes: String(req.body?.notes || '').trim().slice(0, 5000),
        conditions: String(req.body?.conditions || '').trim().slice(0, 5000)
      },
      technicalConclusion: String(req.body?.notes || '').trim().slice(0, 10000),
      finalizedAt,
      reportNumber: `EXT-${finalizedAt.getUTCFullYear()}-${String(project._id).slice(-4).toUpperCase()}-${sequence}`,
      version: 0
    });

    let disbursement = null;
    if (lineForDisbursement && financeForDisbursement) {
      lineForDisbursement.entries.push({
        entryType: 'disbursement',
        paymentStatus: 'pending',
        workflowStatus: 'prepared',
        advanceAccountNumber: sequence,
        fundingParty: 'bank',
        disbursementAmount: amount,
        inspectionId: inspection._id,
        notes: `Preparado desde Tecnico · ${inspection.accountName}`
      });
      await financeForDisbursement.save();
      const entry = lineForDisbursement.entries[lineForDisbursement.entries.length - 1];
      disbursement = { lineId: String(lineForDisbursement._id), entryId: String(entry._id), amount, status: 'prepared' };
    }

    await audit(req, 'inspection.external_created', {
      targetType: 'inspection', targetId: inspection._id, projectId: project._id,
      message: 'Informe externo de avaluo registrado',
      metadata: { sequence, documentId: String(document._id), disbursement }
    });
    res.status(201).json({ ok: true, inspection, documentId: document._id, disbursement });
  } catch (err) {
    if (!documentCreated && uploadedPath && fs.existsSync(uploadedPath)) fs.unlink(uploadedPath, () => {});
    res.status(err.status || (err?.code === 11000 ? 409 : 500)).json({ error: err.message || 'No se pudo registrar el informe externo.' });
  }
});

router.post('/projects/:projectId/finance/inspection-reports/:inspectionId/prepare-disbursement', async (req, res) => {
  try {
    const role = String(req.user?.role || '').toLowerCase();
    if (!['admin', 'bank', 'tecnico', 'financiero', 'contable'].includes(role)) {
      return res.status(403).json({ error: 'No tienes permiso para preparar desembolsos desde Técnico.' });
    }
    const project = await loadTenantProject(req, res);
    if (!project) return;
    const assignments = await ProjectAvaluatorAssignment.find(activeAvaluatorAssignmentFilter(req, project)).select('bankTenantKey').lean();
    const inspection = await Inspection.findOne({
      _id: req.params.inspectionId,
      projectId: project._id,
      projectTenantKey: project.tenantKey,
      bankTenantKey: { $in: assignments.map(item => item.bankTenantKey) },
      status: 'finalized',
      supersededByInspectionId: null
    }).lean();
    if (!inspection) return res.status(404).json({ error: 'Informe no encontrado.' });
    const amount = Math.max(0, Number(req.body?.amount || 0));
    if (!amount) return res.status(400).json({ error: 'Indica un importe mayor que cero.' });
    const finance = await getOrCreate(project._id, project.tenantKey);
    const alreadyLinked = (finance.loanLines || []).some(line => (line.entries || []).some(entry => String(entry.inspectionId || '') === String(inspection._id)));
    if (alreadyLinked) return res.status(409).json({ error: 'Este informe ya está vinculado a un desembolso.' });
    const line = finance.loanLines.id(req.body?.loanLineId);
    if (!line) return res.status(400).json({ error: 'Selecciona una línea bancaria válida.' });
    line.entries.push({
      entryType: 'disbursement', paymentStatus: 'pending', workflowStatus: 'prepared',
      advanceAccountNumber: inspection.sequence, fundingParty: 'bank',
      disbursementAmount: amount, inspectionId: inspection._id,
      notes: String(req.body?.notes || `Preparado desde Técnico · ${inspection.accountName || inspection.reportNumber}`).trim().slice(0, 1000)
    });
    await finance.save();
    const entry = line.entries[line.entries.length - 1];
    await audit(req, 'finance.disbursement_prepared_from_inspection', {
      targetType: 'loanLineEntry', targetId: entry._id, projectId: project._id,
      message: 'Partida de desembolso preparada desde Técnico',
      metadata: { inspectionId: String(inspection._id), lineId: String(line._id), amount }
    });
    res.status(201).json({ ok: true, lineId: line._id, entry });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || 'No se pudo preparar el desembolso.' });
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
    if (inspection.origin === 'external' && inspection.externalReportDocumentId) {
      return res.redirect(307, `/api/documents/${inspection.externalReportDocumentId}/download`);
    }
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
    const count = await CommercialFolder.countDocuments({ projectId, tenantKey: project.tenantKey });
    const stage = await CommercialFolder.create({
      tenantKey: project.tenantKey,
      projectId,
      name: String(name).trim(),
      color: '#111827',
      order: count
    });
    const phaseSeed = {
      stageId: stage._id,
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
    const previousRealUseIds = new Set((ph.uses || []).map(use => String(use?._id || '')));
    const hadActualDisbursement = toNum(ph.disbActual) > 0;
    const requirementCommercialUnits = 'requirements' in req.body
      ? await getFinanceCommercialUnits(projectId, project.tenantKey)
      : [];
    const requirementPromoterId = 'requirements' in req.body ? project.assignedPromoters?.[0] : null;
    const requirementPromoter = requirementPromoterId
      ? await User.findById(requirementPromoterId).select('promoterProfile').lean()
      : null;

    const fields = [
      'startDate','endDate',
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
      else if (f === 'requirements') {
        const incomingRequirements = canManageRequirements(req)
          ? (req.body[f] || [])
          : mergeRequirementStateUpdates(ph.requirements || [], req.body[f] || []);
        ph[f] = normalizePhaseRequirements(incomingRequirements, {
          project: project.toObject ? project.toObject() : project,
          promoterProfile: requirementPromoter?.promoterProfile || {},
          phase: ph.toObject ? ph.toObject() : ph,
          commercialUnits: requirementCommercialUnits
        });
      }
      else ph[f] = req.body[f];
    }
    if ('name' in req.body && String(req.body.name || '').trim()) {
      const cleanName = String(req.body.name).trim();
      ph.name = cleanName;
      if (ph.stageId) {
        await CommercialFolder.updateOne(
          { _id: ph.stageId, projectId, tenantKey: project.tenantKey },
          { $set: { name: cleanName } }
        );
        await syncStageName({ stageId: ph.stageId, tenantKey: project.tenantKey, name: cleanName });
      }
    }
    if (!hadActualDisbursement && toNum(ph.disbActual) > 0 && !ph.disbActualAt) {
      ph.disbActualAt = new Date();
    }
    if ('isCompleted' in req.body) {
      if (ph.isCompleted && !ph.completedAt) ph.completedAt = new Date();
      if (!ph.isCompleted && !('completedAt' in req.body)) ph.completedAt = null;
    }

    if ('uses' in req.body || 'planUses' in req.body || 'planSources' in req.body || 'financialConditions' in req.body) {
      const newUseIds = new Set((ph.uses || []).map(use => String(use?._id || '')).filter(useId => useId && !previousRealUseIds.has(useId)));
      syncLoanLinesFromPhaseUses(doc, ph, { createAll: 'uses' in req.body, createForUseIds: newUseIds });
      validateLoanLineLimits(doc, doc.loanLines || []);
    }

    await doc.save();
    res.json({ ok: true, phase: ph, loanLines: doc.loanLines || [], kpis: doc.kpis() });
  } catch (err) {
    console.error('PUT phase error', err);
    res.status(err.status || 500).json({ error: err.status ? err.message : 'Error al actualizar fase' });
  }
});

function requirementActorRole(req) {
  return String(req.user?.role || '').trim().toLowerCase();
}

function canManageRequirements(req) {
  return ['admin', 'bank'].includes(requirementActorRole(req));
}

function mergeRequirementStateUpdates(current = [], incoming = []) {
  const incomingById = new Map((incoming || []).filter(item => item?._id).map(item => [String(item._id), item]));
  const incomingByNumber = new Map((incoming || []).map(item => [Number(item?.number), item]));
  return (current || []).map(item => {
    const raw = item?.toObject ? item.toObject() : { ...item };
    const update = (raw._id && incomingById.get(String(raw._id))) || incomingByNumber.get(Number(raw.number));
    if (!update) return raw;
    return {
      ...raw,
      information: update.information,
      manualInformation: update.manualInformation,
      structuredData: update.structuredData,
      sourceKey: update.sourceKey,
      sourceLabel: update.sourceLabel,
      status: update.status,
      observations: update.observations
    };
  });
}

function cleanRequirementTitle(value) {
  return String(value || '').trim().slice(0, 500);
}

router.post('/projects/:projectId/finance/phases/:phaseId/requirements', async (req, res) => {
  try {
    if (!canManageRequirements(req)) return res.status(403).json({ error: 'Solo el banco o el superadmin pueden añadir requisitos.' });
    const project = await loadTenantProject(req, res);
    if (!project) return;
    const title = cleanRequirementTitle(req.body?.title);
    if (!title) return res.status(400).json({ error: 'Indica el nombre del requisito.' });
    const doc = await getOrCreate(req.params.projectId, project.tenantKey);
    const phase = doc.phases.id(req.params.phaseId);
    if (!phase) return res.status(404).json({ error: 'Fase no encontrada' });
    const nextNumber = Math.max(REQUIREMENT_TITLES.length, ...(phase.requirements || []).map(item => Number(item.number || 0))) + 1;
    const trackingType = normalizeRequirementTrackingType(req.body?.trackingType, 'none');
    const periodicityUnit = ['weeks', 'months', 'years'].includes(String(req.body?.periodicityUnit || '').toLowerCase()) ? String(req.body.periodicityUnit).toLowerCase() : 'months';
    const periodicityValue = Math.max(1, Math.min(520, Math.round(Number(req.body?.periodicityValue ?? req.body?.periodicityMonths) || 1)));
    const periodicityMonths = periodicityUnit === 'years' ? periodicityValue * 12 : periodicityUnit === 'months' ? periodicityValue : 1;
    phase.requirements.push({
      code: `CUSTOM-${nextNumber}`,
      number: nextNumber,
      title,
      category: normalizeRequirementCategory(req.body?.category, 'general'),
      trackingType,
      responsibleDepartment: String(req.body?.responsibleDepartment || '').trim().slice(0, 240),
      sortOrder: nextNumber,
      isCustom: true,
      sourceKey: 'manual',
      sourceLabel: 'Entrada manual',
      status: 'PENDIENTE',
      ...(trackingType === 'recurring' ? { structuredData: { kind: 'periodicFollowUp', periodicityValue, periodicityUnit, periodicityMonths, lastRecordDate: null, nextReviewDate: null } } : {})
    });
    await doc.save();
    const requirement = phase.requirements[phase.requirements.length - 1];
    await audit(req, 'finance.requirement_created', { targetType: 'project', targetId: project._id, projectId: project._id, message: `Requisito añadido: ${title}` });
    return res.status(201).json({ ok: true, requirement, phase });
  } catch (err) {
    console.error('POST requirement error', err);
    return res.status(500).json({ error: 'No se pudo añadir el requisito.' });
  }
});

router.patch('/projects/:projectId/finance/phases/:phaseId/requirements/:requirementId/status', async (req, res) => {
  try {
    const project = await loadTenantProject(req, res);
    if (!project) return;
    const doc = await getOrCreate(req.params.projectId, project.tenantKey);
    const phase = doc.phases.id(req.params.phaseId);
    if (!phase) return res.status(404).json({ error: 'Fase no encontrada' });
    const requirement = phase.requirements.id(req.params.requirementId);
    if (!requirement || requirement.isArchived) return res.status(404).json({ error: 'Requisito no encontrado' });
    const completed = req.body?.completed === true;
    requirement.status = completed ? 'CUMPLIDO' : 'PENDIENTE';
    requirement.completedAt = completed ? new Date() : null;
    requirement.completedBy = completed && mongoose.isValidObjectId(req.user?._id || req.user?.id) ? (req.user?._id || req.user?.id) : null;
    requirement.completedByRole = completed ? requirementActorRole(req) : '';
    if (String(requirement.trackingType) === 'recurring') {
      const structured = requirement.structuredData || {};
      const periodicityUnit = ['weeks', 'months', 'years'].includes(String(structured.periodicityUnit || '').toLowerCase()) ? String(structured.periodicityUnit).toLowerCase() : 'months';
      const periodicityValue = Math.max(1, Math.min(520, Math.round(Number(structured.periodicityValue ?? structured.periodicityMonths) || 1)));
      requirement.structuredData = {
        ...structured,
        kind: structured.kind || 'periodicFollowUp',
        periodicityValue,
        periodicityUnit,
        periodicityMonths: periodicityUnit === 'years' ? periodicityValue * 12 : periodicityUnit === 'months' ? periodicityValue : 1,
        lastRecordDate: completed ? new Date().toISOString().slice(0, 10) : null,
        nextReviewDate: null
      };
    }
    await doc.save();
    await audit(req, completed ? 'finance.requirement_completed' : 'finance.requirement_reopened', { targetType: 'project', targetId: project._id, projectId: project._id, message: `${completed ? 'Requisito cumplido' : 'Requisito reabierto'}: ${requirement.title}` });
    return res.json({ ok: true, requirement });
  } catch (err) {
    console.error('PATCH requirement status error', err);
    return res.status(500).json({ error: 'No se pudo actualizar el cumplimiento.' });
  }
});

router.patch('/projects/:projectId/finance/phases/:phaseId/requirements/:requirementId', async (req, res) => {
  try {
    if (!canManageRequirements(req)) return res.status(403).json({ error: 'Solo el banco o el superadmin pueden editar requisitos.' });
    const project = await loadTenantProject(req, res);
    if (!project) return;
    const doc = await getOrCreate(req.params.projectId, project.tenantKey);
    const phase = doc.phases.id(req.params.phaseId);
    if (!phase) return res.status(404).json({ error: 'Fase no encontrada' });
    const requirement = phase.requirements.id(req.params.requirementId);
    if (!requirement || requirement.isArchived) return res.status(404).json({ error: 'Requisito no encontrado' });
    const title = cleanRequirementTitle(req.body?.title);
    if (!title) return res.status(400).json({ error: 'Indica el nombre del requisito.' });
    requirement.title = title;
    requirement.category = normalizeRequirementCategory(req.body?.category, requirement.category || 'general');
    requirement.trackingType = normalizeRequirementTrackingType(req.body?.trackingType, requirement.trackingType || 'none');
    requirement.responsibleDepartment = String(req.body?.responsibleDepartment || '').trim().slice(0, 240);
    if (requirement.trackingType === 'recurring') {
      const periodicityUnit = ['weeks', 'months', 'years'].includes(String(req.body?.periodicityUnit || '').toLowerCase()) ? String(req.body.periodicityUnit).toLowerCase() : String(requirement.structuredData?.periodicityUnit || 'months');
      const periodicityValue = Math.max(1, Math.min(520, Math.round(Number(req.body?.periodicityValue ?? req.body?.periodicityMonths ?? requirement.structuredData?.periodicityValue ?? requirement.structuredData?.periodicityMonths) || 1)));
      requirement.structuredData = {
        ...(requirement.structuredData || {}),
        kind: requirement.structuredData?.kind || 'periodicFollowUp',
        periodicityValue,
        periodicityUnit,
        periodicityMonths: periodicityUnit === 'years' ? periodicityValue * 12 : periodicityUnit === 'months' ? periodicityValue : 1
      };
    }
    if (Number(requirement.number) === 24) {
      const previousCoveragePct = Number(requirement.structuredData?.requiredCoveragePct ?? 100);
      const requiredCoveragePct = Math.max(0, Math.min(100, Number(req.body?.requiredCoveragePct ?? previousCoveragePct)));
      requirement.structuredData = {
        ...(requirement.structuredData || {}),
        requiredCoveragePct
      };
      if (requiredCoveragePct !== previousCoveragePct) {
        requirement.status = 'PENDIENTE';
        requirement.completedAt = null;
        requirement.completedBy = null;
        requirement.completedByRole = '';
      }
    }
    if (Number(requirement.number) === 20) {
      const requiredPresalesPct = Math.max(0, Math.min(100, Number(req.body?.requiredPresalesPct ?? requirement.structuredData?.requiredPresalesPct ?? 50)));
      requirement.structuredData = {
        ...(requirement.structuredData || {}),
        requiredPresalesPct,
        requiredPresales: `${requiredPresalesPct}%`
      };
      phase.financialConditions = phase.financialConditions || {};
      phase.financialConditions.requiredPresales = `${requiredPresalesPct}%`;
    }
    await doc.save();
    await audit(req, 'finance.requirement_updated', { targetType: 'project', targetId: project._id, projectId: project._id, message: `Requisito editado: ${title}` });
    return res.json({ ok: true, requirement });
  } catch (err) {
    console.error('PATCH requirement error', err);
    return res.status(500).json({ error: 'No se pudo editar el requisito.' });
  }
});

router.delete('/projects/:projectId/finance/phases/:phaseId/requirements/:requirementId', async (req, res) => {
  try {
    if (!canManageRequirements(req)) return res.status(403).json({ error: 'Solo el banco o el superadmin pueden eliminar requisitos.' });
    const project = await loadTenantProject(req, res);
    if (!project) return;
    const doc = await getOrCreate(req.params.projectId, project.tenantKey);
    const phase = doc.phases.id(req.params.phaseId);
    if (!phase) return res.status(404).json({ error: 'Fase no encontrada' });
    const requirement = phase.requirements.id(req.params.requirementId);
    if (!requirement || requirement.isArchived) return res.status(404).json({ error: 'Requisito no encontrado' });
    requirement.isArchived = true;
    await doc.save();
    await audit(req, 'finance.requirement_archived', { targetType: 'project', targetId: project._id, projectId: project._id, message: `Requisito eliminado: ${requirement.title}` });
    return res.json({ ok: true });
  } catch (err) {
    console.error('DELETE requirement error', err);
    return res.status(500).json({ error: 'No se pudo eliminar el requisito.' });
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
    return await fetchRemoteImage(url, req);
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
        interestAmount: toNum(entry.interestAmount),
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
          interestAmount: 0,
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
    for (const line of (p.loanLines || [])) {
      for (const entry of (line.entries || [])) {
        acc.totalAmortized += toNum(entry.amortizedAmount);
        acc.totalInterestPaid += toNum(entry.interestAmount);
      }
    }

    if (p.disbRequested) acc.disbRequestedCount += 1;
    return acc;
  }, {
    planUses:0, planSources:0, realUses:0, realSources:0,
    disbExpected:0, disbActual:0, disbRequestedCount:0,
    intereses:0, aportes:0, preventas:0,
    totalAmortized:0, totalInterestPaid:0
  });
  totals.totalPaidToBank = totals.totalAmortized + totals.totalInterestPaid;

  const lineSummaries = phases.flatMap(phase => (phase.loanLines || []).map(line => {
    const entries = line.entries || [];
    const bankDisbursed = entries.reduce((sum, entry) => {
      if (entry.entryType !== 'disbursement' || entry.paymentStatus === 'pending') return sum;
      if (entry.fundingParty === 'promoter') return sum;
      return sum + toNum(entry.disbursementAmount);
    }, 0);
    const promoterContributed = entries.reduce((sum, entry) => {
      if (entry.entryType !== 'disbursement' || entry.paymentStatus === 'pending') return sum;
      if (entry.fundingParty === 'promoter') return sum + toNum(entry.disbursementAmount);
      return sum + toNum(entry.promoterContributionAmount);
    }, 0);
    const manualAmortized = entries.reduce((sum, entry) => (
      entry.entryType === 'manual_amortization' ? sum + toNum(entry.amortizedAmount) : sum
    ), 0);
    const salesAmortized = entries.reduce((sum, entry) => (
      entry.entryType === 'sale_amortization' ? sum + toNum(entry.amortizedAmount) : sum
    ), 0);
    const otherAmortized = entries.reduce((sum, entry) => (
      !['manual_amortization', 'sale_amortization'].includes(entry.entryType)
        ? sum + toNum(entry.amortizedAmount)
        : sum
    ), 0);
    const amortized = manualAmortized + salesAmortized + otherAmortized;
    const interestPaid = entries.reduce((sum, entry) => sum + toNum(entry.interestAmount), 0);
    const approved = toNum(line.approvedAmount);
    return {
      phaseId: phase.id,
      phaseName: phase.name,
      line,
      approved,
      bankDisbursed,
      promoterContributed,
      manualAmortized,
      salesAmortized,
      otherAmortized,
      amortized,
      interestPaid,
      totalPaidToBank: amortized + interestPaid,
      outstandingPrincipal: Math.max(0, bankDisbursed - amortized),
      availableToDraw: Math.max(0, approved - bankDisbursed),
      amortizationPct: bankDisbursed > 0 ? amortized / bankDisbursed : 0
    };
  }));

  const banking = lineSummaries.reduce((acc, line) => {
    Object.keys(acc).forEach(key => { acc[key] += toNum(line[key]); });
    return acc;
  }, {
    approved: 0,
    bankDisbursed: 0,
    promoterContributed: 0,
    manualAmortized: 0,
    salesAmortized: 0,
    otherAmortized: 0,
    amortized: 0,
    interestPaid: 0,
    totalPaidToBank: 0,
    outstandingPrincipal: 0,
    availableToDraw: 0
  });
  banking.amortizationPct = banking.bankDisbursed > 0 ? banking.amortized / banking.bankDisbursed : 0;

  const percentExecution = totals.planUses > 0 ? (totals.realUses / totals.planUses) : 0;

  return { phases, totals, percentExecution, lineSummaries, banking };
}

function financeItemsComparison(phase, group) {
  const planItems = group === 'Usos' ? phase.planUsesItems : phase.planSourcesItems;
  const realItems = group === 'Usos' ? phase.uses : phase.sources;
  const rows = new Map();
  const add = (items, key) => (items || []).forEach(item => {
    const name = String(item?.name || 'Sin partida').trim() || 'Sin partida';
    const mapKey = name.toLocaleLowerCase('es');
    const current = rows.get(mapKey) || { name, plan: 0, real: 0 };
    current[key] += toNum(item?.amount);
    rows.set(mapKey, current);
  });
  add(planItems, 'plan');
  add(realItems, 'real');
  return [...rows.values()].map(row => ({
    ...row,
    variance: row.real - row.plan,
    executionPct: row.plan > 0 ? row.real / row.plan : null
  }));
}

function financeMovementLabel(entry) {
  if (entry.entryType === 'interest_payment') return 'Interés pagado';
  if (entry.entryType === 'manual_amortization') return 'Amortización manual';
  if (entry.entryType === 'sale_amortization') return 'Amortización por venta';
  if (entry.entryType === 'disbursement') return 'Desembolso';
  return 'Histórico';
}

function financeFundingLabel(value) {
  if (value === 'promoter') return 'Promotor';
  if (value === 'mixed') return 'Mixto';
  return value ? 'Banco' : '—';
}

function financeMovementStatus(entry) {
  if (entry.entryType === 'interest_payment') return 'Pagado';
  if (entry.entryType === 'sale_amortization' || entry.paymentStatus === 'automatic') return 'Automática';
  if (entry.workflowStatus === 'requested') return 'Solicitado';
  if (entry.workflowStatus === 'returned') return 'Devuelto';
  if (entry.workflowStatus === 'prepared') return 'Preparado';
  if (entry.paymentStatus === 'pending') return 'Pendiente';
  if (entry.entryType === 'manual_amortization') return 'Registrada';
  return 'Desembolsado';
}

const FINANCE_EXPORT_COLORS = {
  navy: 'FF0F172A',
  green: 'FF0B3B2E',
  greenSoft: 'FFD1FAE5',
  blue: 'FF2563EB',
  blueSoft: 'FFDBEAFE',
  amber: 'FFD97706',
  amberSoft: 'FFFEF3C7',
  purple: 'FF7C3AED',
  purpleSoft: 'FFEDE9FE',
  red: 'FFB91C1C',
  redSoft: 'FFFEE2E2',
  slate: 'FF475569',
  slateSoft: 'FFF1F5F9',
  white: 'FFFFFFFF'
};

function styleSheetHeaderRow(row, fill = FINANCE_EXPORT_COLORS.green) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.alignment = { vertical: 'middle', wrapText: true };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  row.height = 30;
  row.eachCell(cell => {
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
  });
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

function styleFinanceTitle(ws, title, subtitle, endColumn) {
  ws.mergeCells(1, 1, 2, endColumn);
  const titleCell = ws.getCell(1, 1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 18, color: { argb: FINANCE_EXPORT_COLORS.white } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FINANCE_EXPORT_COLORS.navy } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
  ws.getRow(1).height = 28;
  ws.getRow(2).height = 12;
  ws.mergeCells(3, 1, 3, endColumn);
  const subtitleCell = ws.getCell(3, 1);
  subtitleCell.value = subtitle;
  subtitleCell.font = { size: 10, color: { argb: FINANCE_EXPORT_COLORS.slate } };
  subtitleCell.alignment = { vertical: 'middle' };
  ws.getRow(3).height = 22;
}

function styleFinanceSection(ws, rowNumber, title, endColumn) {
  ws.mergeCells(rowNumber, 1, rowNumber, endColumn);
  const cell = ws.getCell(rowNumber, 1);
  cell.value = title;
  cell.font = { bold: true, size: 11, color: { argb: FINANCE_EXPORT_COLORS.navy } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FINANCE_EXPORT_COLORS.slateSoft } };
  cell.alignment = { vertical: 'middle' };
  ws.getRow(rowNumber).height = 24;
}

function styleFinanceBody(ws, fromRow, toRow, fromColumn, toColumn) {
  for (let row = fromRow; row <= toRow; row += 1) {
    for (let column = fromColumn; column <= toColumn; column += 1) {
      const cell = ws.getRow(row).getCell(column);
      cell.alignment = { vertical: 'middle', wrapText: false };
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFE2E8F0' } } };
      if ((row - fromRow) % 2 === 1) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
      }
    }
  }
}

function styleFinanceTotalRow(row) {
  row.font = { bold: true, color: { argb: FINANCE_EXPORT_COLORS.navy } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: FINANCE_EXPORT_COLORS.greenSoft } };
  row.eachCell(cell => {
    cell.border = {
      top: { style: 'thin', color: { argb: FINANCE_EXPORT_COLORS.green } },
      bottom: { style: 'thin', color: { argb: FINANCE_EXPORT_COLORS.green } }
    };
  });
}

function setFinanceMoneyFormat(ws, rows, columns) {
  rows.forEach(row => columns.forEach(column => {
    ws.getRow(row).getCell(column).numFmt = '#,##0.00;[Red]-#,##0.00;–';
  }));
}

async function exportFinanceXlsx({ req, res, projectId, projectName, projectCurrency = 'PAB', updatedAt, doc, kpis, chartsPayload, phaseId = '', commercialUnits = [] }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'TrustForBanks';
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;

  const snap = buildFinanceSnapshot(doc, phaseId);
  const customerReceipts = (commercialUnits || []).reduce((totals, unit) => {
    const recipients = customerPaymentRecipientTotals({ customerPaymentAccounts: unit.customerPaymentAccounts || [] });
    totals.bank += recipients.bank;
    totals.promoter += recipients.promoter;
    return totals;
  }, { bank: 0, promoter: 0 });
  snap.banking.lineTotalPaidToBank = snap.banking.totalPaidToBank;
  snap.banking.customerPaidToBank = customerReceipts.bank;
  snap.banking.totalPaidToBank += customerReceipts.bank;
  const updatedLabel = updatedAt ? new Date(updatedAt).toLocaleString('es-ES') : '—';
  const subtitle = `${projectName || String(projectId)} · Actualizado ${updatedLabel} · Moneda ${projectCurrency}`;

  // ===== Resumen ejecutivo =====
  const sh0 = wb.addWorksheet('Resumen', { properties: { tabColor: { argb: FINANCE_EXPORT_COLORS.green } } });
  sh0.columns = Array.from({ length: 8 }, () => ({ width: 18 }));
  styleFinanceTitle(sh0, phaseId ? 'Resumen financiero de la fase' : 'Resumen financiero del proyecto', subtitle, 8);

  const cards = [
    ['Financiación aprobada', snap.banking.approved, FINANCE_EXPORT_COLORS.navy],
    ['Capital desembolsado', snap.banking.bankDisbursed, FINANCE_EXPORT_COLORS.blue],
    ['Disponible por desembolsar', snap.banking.availableToDraw, FINANCE_EXPORT_COLORS.purple],
    ['Capital amortizado', snap.banking.amortized, FINANCE_EXPORT_COLORS.green],
    ['Intereses pagados', snap.banking.interestPaid, FINANCE_EXPORT_COLORS.amber],
    ['Total pagado al banco', snap.banking.totalPaidToBank, FINANCE_EXPORT_COLORS.green],
    ['Capital pendiente', snap.banking.outstandingPrincipal, FINANCE_EXPORT_COLORS.red],
    ['Ejecución de usos', snap.percentExecution, FINANCE_EXPORT_COLORS.slate]
  ];
  cards.forEach(([label, value, color], index) => {
    const block = index % 4;
    const row = index < 4 ? 5 : 8;
    const col = (block * 2) + 1;
    sh0.mergeCells(row, col, row, col + 1);
    sh0.mergeCells(row + 1, col, row + 1, col + 1);
    const labelCell = sh0.getCell(row, col);
    const valueCell = sh0.getCell(row + 1, col);
    labelCell.value = label;
    valueCell.value = value;
    labelCell.font = { bold: true, size: 9, color: { argb: FINANCE_EXPORT_COLORS.white } };
    valueCell.font = { bold: true, size: 15, color: { argb: color } };
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
    valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    labelCell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    valueCell.alignment = { horizontal: 'center', vertical: 'middle' };
    valueCell.numFmt = label === 'Ejecución de usos' ? '0.0%' : '#,##0.00;[Red]-#,##0.00;–';
    for (let c = col; c <= col + 1; c += 1) {
      sh0.getCell(row, c).border = { top: { style: 'thin', color: { argb: color } }, left: { style: 'thin', color: { argb: color } }, right: { style: 'thin', color: { argb: color } } };
      sh0.getCell(row + 1, c).border = { bottom: { style: 'thin', color: { argb: color } }, left: { style: 'thin', color: { argb: color } }, right: { style: 'thin', color: { argb: color } } };
    }
  });
  [5, 8].forEach(row => { sh0.getRow(row).height = 28; sh0.getRow(row + 1).height = 32; });

  styleFinanceSection(sh0, 11, 'Conciliación bancaria', 8);
  sh0.getRow(12).values = ['Comprobación', '', 'Importe inicial', 'Movimientos', 'Resultado', '', 'Diferencia', 'Estado'];
  styleSheetHeaderRow(sh0.getRow(12));
  sh0.getRow(13).values = ['Capital desembolsado = amortizado + pendiente', '', snap.banking.bankDisbursed, snap.banking.amortized, snap.banking.outstandingPrincipal, '', snap.banking.bankDisbursed - snap.banking.amortized - snap.banking.outstandingPrincipal, 'CUADRA'];
  sh0.getRow(14).values = ['Pago total = amortizaciones + intereses + abonos cliente', '', snap.banking.totalPaidToBank, snap.banking.amortized, snap.banking.interestPaid + snap.banking.customerPaidToBank, '', snap.banking.totalPaidToBank - snap.banking.amortized - snap.banking.interestPaid - snap.banking.customerPaidToBank, 'CUADRA'];
  sh0.mergeCells('A13:B13'); sh0.mergeCells('E13:F13');
  sh0.mergeCells('A14:B14'); sh0.mergeCells('E14:F14');
  styleFinanceBody(sh0, 13, 14, 1, 8);
  setFinanceMoneyFormat(sh0, [13, 14], [3, 4, 5, 7]);
  [13, 14].forEach(row => {
    sh0.getRow(row).height = 28;
    sh0.getCell(row, 1).alignment = { vertical: 'middle', wrapText: true };
    sh0.getCell(row, 8).font = { bold: true, color: { argb: FINANCE_EXPORT_COLORS.green } };
  });

  styleFinanceSection(sh0, 16, 'Plan, ejecución y fuentes', 8);
  sh0.getRow(17).values = ['Concepto', '', 'Plan', 'Real', 'Desviación', '', '% ejecución', ''];
  styleSheetHeaderRow(sh0.getRow(17));
  const summaryRows = [
    ['Usos', snap.totals.planUses, snap.totals.realUses],
    ['Fuentes', snap.totals.planSources, snap.totals.realSources]
  ];
  summaryRows.forEach(([label, plan, real], index) => {
    const row = 18 + index;
    sh0.getRow(row).values = [label, '', plan, real, real - plan, '', plan > 0 ? real / plan : null, ''];
    sh0.mergeCells(row, 1, row, 2); sh0.mergeCells(row, 5, row, 6); sh0.mergeCells(row, 7, row, 8);
  });
  styleFinanceBody(sh0, 18, 19, 1, 8);
  setFinanceMoneyFormat(sh0, [18, 19], [3, 4, 5]);
  [18, 19].forEach(row => { sh0.getCell(row, 7).numFmt = '0.0%'; });

  styleFinanceSection(sh0, 21, 'Desembolsos de fase (dato operativo)', 8);
  sh0.getRow(22).values = ['Fase', 'Inicio', 'Fin', 'Esperado', 'Real de fase', 'Solicitado', 'Fecha solicitud', ''];
  styleSheetHeaderRow(sh0.getRow(22), FINANCE_EXPORT_COLORS.slate);
  snap.phases.forEach((phase, index) => {
    const row = 23 + index;
    sh0.getRow(row).values = [phase.name, phase.startDate ? new Date(phase.startDate) : '', phase.endDate ? new Date(phase.endDate) : '', phase.disbExpected, phase.disbActual, phase.disbRequested ? 'Sí' : 'No', phase.disbRequestedAt ? new Date(phase.disbRequestedAt) : '', ''];
    [2, 3, 7].forEach(column => { sh0.getRow(row).getCell(column).numFmt = 'dd/mm/yyyy'; });
    setFinanceMoneyFormat(sh0, [row], [4, 5]);
  });
  if (snap.phases.length) styleFinanceBody(sh0, 23, 22 + snap.phases.length, 1, 8);
  sh0.views = [{ state: 'frozen', ySplit: 3, showGridLines: false }];
  sh0.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 9 };

  // ===== Usos y fuentes =====
  const sh1 = wb.addWorksheet('Usos y fuentes', { properties: { tabColor: { argb: FINANCE_EXPORT_COLORS.purple } } });
  sh1.columns = [{ width: 22 }, { width: 13 }, { width: 34 }, { width: 17 }, { width: 17 }, { width: 17 }, { width: 14 }];
  styleFinanceTitle(sh1, 'Usos y fuentes · Plan frente a real', subtitle, 7);
  sh1.getRow(5).values = ['Fase', 'Grupo', 'Partida', 'Plan', 'Real', 'Desviación', '% ejecución'];
  styleSheetHeaderRow(sh1.getRow(5));
  const useSourceRows = [];
  snap.phases.forEach(phase => ['Usos', 'Fuentes'].forEach(group => {
    const detail = financeItemsComparison(phase, group);
    detail.forEach(item => useSourceRows.push({ phase: phase.name, group, ...item, total: false }));
    const plan = detail.reduce((sum, item) => sum + item.plan, 0);
    const real = detail.reduce((sum, item) => sum + item.real, 0);
    useSourceRows.push({ phase: phase.name, group, name: `Total ${group.toLocaleLowerCase('es')}`, plan, real, variance: real - plan, executionPct: plan > 0 ? real / plan : null, total: true });
  }));
  useSourceRows.forEach(item => {
    const row = sh1.addRow([item.phase, item.group, item.name, item.plan, item.real, item.variance, item.executionPct]);
    if (item.total) styleFinanceTotalRow(row);
    else if (item.group === 'Usos') row.getCell(2).font = { bold: true, color: { argb: FINANCE_EXPORT_COLORS.blue } };
    else row.getCell(2).font = { bold: true, color: { argb: FINANCE_EXPORT_COLORS.purple } };
  });
  if (sh1.rowCount > 5) {
    styleFinanceBody(sh1, 6, sh1.rowCount, 1, 7);
    useSourceRows.forEach((item, index) => { if (item.total) styleFinanceTotalRow(sh1.getRow(6 + index)); });
    setFinanceMoneyFormat(sh1, Array.from({ length: sh1.rowCount - 5 }, (_, i) => i + 6), [4, 5, 6]);
    for (let row = 6; row <= sh1.rowCount; row += 1) sh1.getRow(row).getCell(7).numFmt = '0.0%';
    sh1.autoFilter = { from: 'A5', to: `G${sh1.rowCount}` };
  }
  sh1.views = [{ state: 'frozen', ySplit: 5, showGridLines: false }];
  sh1.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };

  // ===== Líneas bancarias =====
  const sh2 = wb.addWorksheet('Líneas bancarias', { properties: { tabColor: { argb: FINANCE_EXPORT_COLORS.blue } } });
  sh2.columns = [20, 28, 16, 18, 18, 18, 18, 16, 18, 16, 18, 18, 14, 30].map(width => ({ width }));
  styleFinanceTitle(sh2, 'Posición por línea bancaria', subtitle, 14);
  sh2.getRow(5).values = ['Fase', 'Línea', 'Aprobado', 'Desembolsado banco', 'Disponible', 'Amortización manual', 'Amortización por ventas', 'Otras amortizaciones', 'Amortización total', 'Intereses pagados', 'Total pagado banco', 'Capital pendiente', '% amortizado', 'Notas'];
  styleSheetHeaderRow(sh2.getRow(5));
  snap.lineSummaries.forEach(item => sh2.addRow([
    item.phaseName, item.line.name, item.approved, item.bankDisbursed, item.availableToDraw,
    item.manualAmortized, item.salesAmortized, item.otherAmortized, item.amortized,
    item.interestPaid, item.totalPaidToBank, item.outstandingPrincipal, item.amortizationPct,
    item.line.notes
  ]));
  const lineTotalRow = sh2.addRow(['TOTAL', '', snap.banking.approved, snap.banking.bankDisbursed, snap.banking.availableToDraw, snap.banking.manualAmortized, snap.banking.salesAmortized, snap.banking.otherAmortized, snap.banking.amortized, snap.banking.interestPaid, snap.banking.lineTotalPaidToBank, snap.banking.outstandingPrincipal, snap.banking.amortizationPct, '']);
  styleFinanceTotalRow(lineTotalRow);
  if (sh2.rowCount > 5) {
    styleFinanceBody(sh2, 6, sh2.rowCount, 1, 14);
    styleFinanceTotalRow(lineTotalRow);
    setFinanceMoneyFormat(sh2, Array.from({ length: sh2.rowCount - 5 }, (_, i) => i + 6), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    for (let row = 6; row <= sh2.rowCount; row += 1) sh2.getRow(row).getCell(13).numFmt = '0.0%';
    sh2.autoFilter = { from: 'A5', to: `N${Math.max(5, sh2.rowCount - 1)}` };
  }
  sh2.views = [{ state: 'frozen', ySplit: 5, xSplit: 2, showGridLines: false }];
  sh2.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };

  // ===== Movimientos =====
  const sh3 = wb.addWorksheet('Movimientos', { properties: { tabColor: { argb: FINANCE_EXPORT_COLORS.amber } } });
  sh3.columns = [20, 26, 13, 24, 13, 14, 17, 18, 18, 18, 18, 16, 18, 15, 15, 18, 17, 18, 18, 34, 34].map(width => ({ width }));
  styleFinanceTitle(sh3, 'Detalle completo de movimientos', subtitle, 21);
  sh3.getRow(5).values = ['Fase', 'Línea', 'Cuenta avance', 'Tipo', 'Aportante', 'Fecha', 'Nº préstamo', 'Desembolso banco', 'Aporte promotor', 'Importe pendiente', 'Amortización', 'Interés pagado', 'Pago al banco', 'Vencimiento', 'Estado', 'Solicitud', 'Confirmado por', 'Referencia', 'Informe avalúo', 'Detalle / unidad', 'Notas'];
  styleSheetHeaderRow(sh3.getRow(5));
  const movementTotals = { bank: 0, promoter: 0, pending: 0, amortized: 0, interest: 0, paid: 0 };
  const movementStyles = [];
  snap.phases.forEach(phase => (phase.loanLines || []).forEach(line => (line.entries || []).forEach(entry => {
    const isDisbursement = entry.entryType === 'disbursement';
    const isPending = isDisbursement && entry.paymentStatus === 'pending';
    const bank = isDisbursement && !isPending && ['bank', 'mixed'].includes(entry.fundingParty || 'bank') ? toNum(entry.disbursementAmount) : 0;
    const promoter = isDisbursement && !isPending
      ? (entry.fundingParty === 'promoter' ? toNum(entry.disbursementAmount) : toNum(entry.promoterContributionAmount))
      : 0;
    const pending = isPending ? toNum(entry.disbursementAmount) : 0;
    const amortized = toNum(entry.amortizedAmount);
    const interest = toNum(entry.interestAmount);
    const paid = amortized + interest;
    movementTotals.bank += bank; movementTotals.promoter += promoter; movementTotals.pending += pending;
    movementTotals.amortized += amortized; movementTotals.interest += interest; movementTotals.paid += paid;
    const saleDetail = entry.entryType === 'sale_amortization' ? entry.notes : '';
    const row = sh3.addRow([
      phase.name, line.name, entry.advanceAccountNumber, financeMovementLabel(entry), financeFundingLabel(entry.fundingParty),
      entry.date ? new Date(entry.date) : '', entry.loanNumber, bank, promoter, pending, amortized, interest, paid,
      entry.maturityDate ? new Date(entry.maturityDate) : '', financeMovementStatus(entry),
      entry.requestedAt ? new Date(entry.requestedAt) : '', entry.disbursedByRole, entry.transferReference,
      entry.inspectionId, saleDetail, saleDetail ? '' : entry.notes
    ]);
    const fill = entry.entryType === 'disbursement' ? FINANCE_EXPORT_COLORS.blueSoft
      : entry.entryType === 'interest_payment' ? FINANCE_EXPORT_COLORS.amberSoft
        : entry.entryType === 'sale_amortization' ? FINANCE_EXPORT_COLORS.purpleSoft
          : FINANCE_EXPORT_COLORS.greenSoft;
    movementStyles.push({ row: row.number, fill });
    row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    row.getCell(4).font = { bold: true, color: { argb: FINANCE_EXPORT_COLORS.navy } };
  })));
  const movementTotalRow = sh3.addRow(['TOTAL', '', '', '', '', '', '', movementTotals.bank, movementTotals.promoter, movementTotals.pending, movementTotals.amortized, movementTotals.interest, movementTotals.paid, '', '', '', '', '', '', '', '']);
  styleFinanceTotalRow(movementTotalRow);
  if (sh3.rowCount > 5) {
    styleFinanceBody(sh3, 6, sh3.rowCount, 1, 21);
    movementStyles.forEach(({ row, fill }) => {
      sh3.getRow(row).getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
      sh3.getRow(row).getCell(4).font = { bold: true, color: { argb: FINANCE_EXPORT_COLORS.navy } };
    });
    styleFinanceTotalRow(movementTotalRow);
    for (let row = 6; row <= sh3.rowCount; row += 1) {
      [6, 14, 16].forEach(column => { sh3.getRow(row).getCell(column).numFmt = 'dd/mm/yyyy'; });
    }
    setFinanceMoneyFormat(sh3, Array.from({ length: sh3.rowCount - 5 }, (_, i) => i + 6), [8, 9, 10, 11, 12, 13]);
    sh3.autoFilter = { from: 'A5', to: `U${Math.max(5, sh3.rowCount - 1)}` };
  }
  sh3.views = [{ state: 'frozen', ySplit: 5, xSplit: 2, showGridLines: false }];
  sh3.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };

  // ===== Abonos de clientes (dato único de la venta) =====
  const sh4 = wb.addWorksheet('Abonos clientes', { properties: { tabColor: { argb: FINANCE_EXPORT_COLORS.green } } });
  sh4.columns = [18, 28, 28, 16, 16, 18, 16, 16, 18, 18, 15].map(width => ({ width }));
  styleFinanceTitle(sh4, 'Seguimiento de abonos de clientes', subtitle, 11);
  sh4.getRow(5).values = ['Unidad', 'Cliente', 'Concepto', 'Beneficiario', 'Fecha del abono', 'Nº recibo', 'Importe pago', 'Total acordado', 'Pagado acumulado', 'Saldo pendiente', 'Estado'];
  styleSheetHeaderRow(sh4.getRow(5));
  const recipientLabels = { bank: 'Banco', promoter: 'Promotor', other: 'Otro' };
  const statusLabels = { paid: 'Pagado', partial: 'Parcial', pending: 'Pendiente', not_applicable: 'No aplica' };
  for (const unit of (commercialUnits || [])) {
    for (const account of (unit.customerPaymentAccounts || [])) {
      const payments = Array.isArray(account.payments) && account.payments.length ? account.payments : [null];
      let accumulated = 0;
      for (const payment of payments) {
        accumulated += toNum(payment?.amount);
        const agreed = toNum(account.summary?.agreed);
        const balance = Math.max(0, agreed - accumulated);
        sh4.addRow([
          unit.unitLabel || unit.lot, unit.clientName, unit.clientName || account.concept,
          recipientLabels[payment?.recipient || account.recipient] || 'Otro', payment?.paymentDate ? new Date(payment.paymentDate) : '',
          payment?.receiptNumber || '', toNum(payment?.amount), agreed, accumulated, balance,
          statusLabels[account.summary?.status] || account.summary?.status || ''
        ]);
      }
    }
  }
  if (sh4.rowCount > 5) {
    styleFinanceBody(sh4, 6, sh4.rowCount, 1, 11);
    for (let row = 6; row <= sh4.rowCount; row += 1) sh4.getRow(row).getCell(5).numFmt = 'dd/mm/yyyy';
    setFinanceMoneyFormat(sh4, Array.from({ length: sh4.rowCount - 5 }, (_, i) => i + 6), [7, 8, 9, 10]);
    sh4.autoFilter = { from: 'A5', to: `K${sh4.rowCount}` };
  }
  sh4.views = [{ state: 'frozen', ySplit: 5, xSplit: 2, showGridLines: false }];
  sh4.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };

  // ===== Hoja Gráficas (si llegan) =====
  const charts = chartsPayload || {};
  const chartEntries = Object.entries(charts).filter(([_, v]) => typeof v === 'string' && v.startsWith('data:image/'));
  if (chartEntries.length) {
    const shC = wb.addWorksheet('Gráficas', { properties: { tabColor: { argb: FINANCE_EXPORT_COLORS.slate } } });
    styleFinanceTitle(shC, 'Gráficas financieras', subtitle, 10);
    shC.views = [{ showGridLines: false }];
    let row = 5;

    for (const [title, dataUrl] of chartEntries) {
      const m = /^data:image\/(png|jpe?g);base64,(.+)$/i.exec(String(dataUrl));
      if (!m) continue;

      shC.getCell(`A${row}`).value = title;
      shC.getRow(row).font = { bold: true, size: 11, color: { argb: FINANCE_EXPORT_COLORS.navy } };
      row += 1;

      const imgId = wb.addImage({ base64: m[2], extension: 'png' });
      shC.addImage(imgId, { tl: { col: 0, row }, ext: { width: 900, height: 340 } });
      row += 20;
    }
  }

  const exportedPhaseName = String(snap.phases?.[0]?.name || 'Fase')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'Fase';
  const phaseLabel = /^fase(?:_|$)/i.test(exportedPhaseName) ? exportedPhaseName : `Fase_${exportedPhaseName}`;
  const filename = phaseId ? `Lineas_y_movimientos_${phaseLabel}.xlsx` : `finanzas_${projectId}.xlsx`;
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
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

function financePdfHeader(doc, { projectName, updatedAt, title }) {
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
    .text(title || doc.__reportTitle || 'Finanzas - Resumen ejecutivo', margin + 140, 22, { width: pageW - margin*2 - 140 });

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
  financePdfEnsureSpace(doc, 50);
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

  const cardW = (contentW - 30) / 4;
  const cardH = 58;

  const kpis = [
    { label: 'Financiación aprobada', value: moneyES(snap.banking.approved, projectCurrency), color: '#0F172A' },
    { label: 'Capital desembolsado', value: moneyES(snap.banking.bankDisbursed, projectCurrency), color: '#2563EB' },
    { label: 'Disponible por desembolsar', value: moneyES(snap.banking.availableToDraw, projectCurrency), color: '#7C3AED' },
    { label: 'Capital amortizado', value: moneyES(snap.banking.amortized, projectCurrency), color: '#047857' },
    { label: 'Intereses pagados', value: moneyES(snap.banking.interestPaid, projectCurrency), color: '#D97706' },
    { label: 'Total pagado al banco', value: moneyES(snap.banking.totalPaidToBank, projectCurrency), color: '#0B3B2E' },
    { label: 'Capital pendiente', value: moneyES(snap.banking.outstandingPrincipal, projectCurrency), color: '#B91C1C' },
    { label: 'Ejecución de usos', value: `${(snap.percentExecution * 100).toFixed(1)}%`, color: '#475569' }
  ];

  const drawCard = (x, y, { label, value, color }) => {
    doc.save();
    pdfRoundRect(doc, x, y, cardW, cardH, 8).fill('#F8FAFC');
    pdfRoundRect(doc, x, y, cardW, cardH, 8).lineWidth(1).stroke(color);
    doc.rect(x, y, 5, cardH).fill(color);
    doc.restore();

    doc.fontSize(8).fillColor('#64748B').text(label, x + 12, y + 9, { width: cardW - 20, height: 14, ellipsis: true });
    doc.fontSize(13).fillColor(color).text(value, x + 12, y + 29, { width: cardW - 20, height: 18, ellipsis: true });
  };

  const y0 = doc.y;
  kpis.forEach((kpi, index) => {
    const column = index % 4;
    const row = Math.floor(index / 4);
    drawCard(margin + column * (cardW + 10), y0 + row * (cardH + 10), kpi);
  });
  doc.y = y0 + (cardH * 2) + 30;
}

function financePdfEnsureSpace(doc, h) {
  const bottomSafe = doc.page.height - doc.page.margins.bottom - 60;
  if (doc.y + h > bottomSafe) {
    doc.addPage();
    financePdfHeader(doc, {
      projectName: doc.__projectName || null,
      updatedAt: doc.__updatedAt || null,
      title: doc.__reportTitle || null
    });
  }
}

function financePdfTable(doc, rows, cols, options = {}) {
  const margin = doc.page.margins.left;
  const width = doc.page.width - margin * 2;
  const pctTotal = cols.reduce((sum, column) => sum + Number(column.wPct || 0), 0) || 1;
  const colW = cols.map(column => width * (Number(column.wPct || 0) / pctTotal));
  const safeRows = Array.isArray(rows) ? rows : [];
  if (safeRows.length === 0) {
    financePdfEnsureSpace(doc, 18);
    doc.fontSize(9).fillColor('#6b7280').text('- Sin datos -', margin, doc.y);
    doc.y += 8;
    doc.fillColor('#111827');
    return;
  }

  const HEADER_H = options.headerHeight || 25;
  const ROW_H = options.rowHeight || 21;
  const fontSize = options.fontSize || 7.5;
  financePdfEnsureSpace(doc, HEADER_H + ROW_H);

  const drawHeader = () => {
    const y = doc.y;
    doc.save();
    doc.rect(margin, y, width, HEADER_H).fill(options.headerFill || '#0B3B2E');
    doc.fontSize(8).fillColor('#FFFFFF').font('Helvetica-Bold');
    let x = margin;
    cols.forEach((c, i) => {
      doc.text(c.label, x + 4, y + 7, { width: Math.max(1, colW[i] - 8), height: HEADER_H - 10, align: c.align || 'left', ellipsis: true });
      x += colW[i];
    });
    doc.restore();
    doc.y = y + HEADER_H;
  };

  drawHeader();
  safeRows.forEach((row, rowIndex) => {
    const bottomSafe = doc.page.height - doc.page.margins.bottom - 60;
    if (doc.y + ROW_H > bottomSafe) {
      doc.addPage();
      financePdfHeader(doc, {
        projectName: doc.__projectName || null,
        updatedAt: doc.__updatedAt || null,
        title: doc.__reportTitle || null
      });
      drawHeader();
    }
    const y = doc.y;
    const rowStyle = typeof options.rowStyle === 'function' ? (options.rowStyle(row, rowIndex) || {}) : {};
    const fill = rowStyle.fill || row._fill || (rowIndex % 2 ? '#F8FAFC' : '#FFFFFF');
    doc.save();
    doc.rect(margin, y, width, ROW_H).fill(fill);
    doc.moveTo(margin, y + ROW_H).lineTo(margin + width, y + ROW_H).lineWidth(0.35).stroke('#E2E8F0');
    doc.font(row._total ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize).fillColor(rowStyle.color || row._color || '#111827');
    let x = margin;
    cols.forEach((c, i) => {
      const v = (row[c.key] === null || row[c.key] === undefined) ? '' : String(row[c.key]);
      doc.text(v, x + 4, y + 6, { width: Math.max(1, colW[i] - 8), height: ROW_H - 8, align: c.align || 'left', ellipsis: true });
      x += colW[i];
    });
    doc.restore();
    doc.y = y + ROW_H;
  });
  doc.y += 8;
}

async function exportFinancePdf({ req, res, projectId, projectName, projectCurrency = 'PAB', updatedAt, doc, chartsPayload, phaseId = '', commercialUnits = [] }) {
  const snap = buildFinanceSnapshot(doc, phaseId);
  const customerPaidToBank = (commercialUnits || []).reduce((sum, unit) => (
    sum + customerPaymentRecipientTotals({ customerPaymentAccounts: unit.customerPaymentAccounts || [] }).bank
  ), 0);
  snap.banking.customerPaidToBank = customerPaidToBank;
  snap.banking.totalPaidToBank += customerPaidToBank;
  const money = (n) => moneyES(n, projectCurrency);
  const reportTitle = phaseId ? `Finanzas - ${snap.phases[0]?.name || 'Fase'}` : 'Finanzas - Resumen ejecutivo';

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${phaseId ? `fase_${phaseId}` : `finanzas_${projectId}`}.pdf"`);

  const pdf = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36, bufferPages: true, info: { Title: reportTitle } });
  pdf.pipe(res);

  pdf.__projectName = projectName;
  pdf.__updatedAt = updatedAt;
  pdf.__reportTitle = reportTitle;
  financePdfHeader(pdf, { projectName, updatedAt, title: reportTitle });

  financePdfKpiCards(pdf, snap, projectCurrency);

  financePdfSection(pdf, 'Conciliación bancaria');
  financePdfTable(pdf, [
    { concept: 'Capital', base: money(snap.banking.bankDisbursed), component1: money(snap.banking.amortized), component2: money(snap.banking.outstandingPrincipal), difference: money(snap.banking.bankDisbursed - snap.banking.amortized - snap.banking.outstandingPrincipal), status: 'CUADRA' },
    { concept: 'Pagos al banco', base: money(snap.banking.totalPaidToBank), component1: money(snap.banking.amortized), component2: money(snap.banking.interestPaid + snap.banking.customerPaidToBank), difference: money(snap.banking.totalPaidToBank - snap.banking.amortized - snap.banking.interestPaid - snap.banking.customerPaidToBank), status: 'CUADRA' }
  ], [
    { key: 'concept', label: 'Comprobación', wPct: 0.22 },
    { key: 'base', label: 'Total', wPct: 0.17, align: 'right' },
    { key: 'component1', label: 'Amortización', wPct: 0.17, align: 'right' },
    { key: 'component2', label: 'Pendiente / interés', wPct: 0.18, align: 'right' },
    { key: 'difference', label: 'Diferencia', wPct: 0.16, align: 'right' },
    { key: 'status', label: 'Estado', wPct: 0.10, align: 'center' }
  ], { rowStyle: () => ({ color: '#047857' }) });

  financePdfSection(pdf, 'Plan y ejecución');
  financePdfTable(pdf, [
    { concept: 'Usos', plan: money(snap.totals.planUses), real: money(snap.totals.realUses), variance: money(snap.totals.realUses - snap.totals.planUses), execution: `${(snap.percentExecution * 100).toFixed(1)}%` },
    { concept: 'Fuentes', plan: money(snap.totals.planSources), real: money(snap.totals.realSources), variance: money(snap.totals.realSources - snap.totals.planSources), execution: snap.totals.planSources > 0 ? `${((snap.totals.realSources / snap.totals.planSources) * 100).toFixed(1)}%` : '-' }
  ], [
    { key: 'concept', label: 'Concepto', wPct: 0.28 },
    { key: 'plan', label: 'Plan', wPct: 0.18, align: 'right' },
    { key: 'real', label: 'Real', wPct: 0.18, align: 'right' },
    { key: 'variance', label: 'Desviación', wPct: 0.18, align: 'right' },
    { key: 'execution', label: '% ejecución', wPct: 0.18, align: 'right' }
  ]);

  for (const phase of snap.phases) {
    pdf.addPage();
    financePdfHeader(pdf, { projectName, updatedAt, title: reportTitle });
    financePdfSection(pdf, `Usos y fuentes - ${phase.name}`);
    pdf.fontSize(9).fillColor('#475569').text(`Periodo: ${fmtDate(phase.startDate)} a ${fmtDate(phase.endDate)} · Desembolso operativo esperado: ${money(phase.disbExpected)} · Real de fase: ${money(phase.disbActual)}`);
    pdf.y += 8;

    const comparisonRows = [];
    ['Usos', 'Fuentes'].forEach(group => {
      const detail = financeItemsComparison(phase, group);
      detail.forEach(item => comparisonRows.push({
        group,
        item: item.name,
        plan: money(item.plan),
        real: money(item.real),
        variance: money(item.variance),
        execution: item.executionPct === null ? '-' : `${(item.executionPct * 100).toFixed(1)}%`,
        _fill: group === 'Usos' ? '#EFF6FF' : '#F5F3FF'
      }));
      const plan = detail.reduce((sum, item) => sum + item.plan, 0);
      const real = detail.reduce((sum, item) => sum + item.real, 0);
      comparisonRows.push({
        group,
        item: `Total ${group.toLocaleLowerCase('es')}`,
        plan: money(plan),
        real: money(real),
        variance: money(real - plan),
        execution: plan > 0 ? `${((real / plan) * 100).toFixed(1)}%` : '-',
        _fill: '#D1FAE5',
        _total: true
      });
    });
    financePdfTable(pdf, comparisonRows, [
      { key: 'group', label: 'Grupo', wPct: 0.12 },
      { key: 'item', label: 'Partida', wPct: 0.28 },
      { key: 'plan', label: 'Plan', wPct: 0.17, align: 'right' },
      { key: 'real', label: 'Real', wPct: 0.17, align: 'right' },
      { key: 'variance', label: 'Desviación', wPct: 0.16, align: 'right' },
      { key: 'execution', label: '% ejecución', wPct: 0.10, align: 'right' }
    ]);

    financePdfSection(pdf, `Líneas bancarias - ${phase.name}`);
    const phaseLines = snap.lineSummaries.filter(item => item.phaseId === phase.id);
    const lineRows = phaseLines.map(item => ({
      name: item.line.name,
      approved: money(item.approved),
      disbursed: money(item.bankDisbursed),
      available: money(item.availableToDraw),
      manual: money(item.manualAmortized),
      sales: money(item.salesAmortized),
      amortized: money(item.amortized),
      interest: money(item.interestPaid),
      paid: money(item.totalPaidToBank),
      pending: money(item.outstandingPrincipal)
    }));
    if (phaseLines.length) lineRows.push({
      name: 'TOTAL',
      approved: money(phaseLines.reduce((sum, item) => sum + item.approved, 0)),
      disbursed: money(phaseLines.reduce((sum, item) => sum + item.bankDisbursed, 0)),
      available: money(phaseLines.reduce((sum, item) => sum + item.availableToDraw, 0)),
      manual: money(phaseLines.reduce((sum, item) => sum + item.manualAmortized, 0)),
      sales: money(phaseLines.reduce((sum, item) => sum + item.salesAmortized, 0)),
      amortized: money(phaseLines.reduce((sum, item) => sum + item.amortized, 0)),
      interest: money(phaseLines.reduce((sum, item) => sum + item.interestPaid, 0)),
      paid: money(phaseLines.reduce((sum, item) => sum + item.totalPaidToBank, 0)),
      pending: money(phaseLines.reduce((sum, item) => sum + item.outstandingPrincipal, 0)),
      _fill: '#D1FAE5',
      _total: true
    });
    financePdfTable(pdf, lineRows, [
      { key: 'name', label: 'Línea', wPct: 0.15 },
      { key: 'approved', label: 'Aprobado', wPct: 0.095, align: 'right' },
      { key: 'disbursed', label: 'Desembolsado', wPct: 0.105, align: 'right' },
      { key: 'available', label: 'Disponible', wPct: 0.095, align: 'right' },
      { key: 'manual', label: 'Amort. manual', wPct: 0.095, align: 'right' },
      { key: 'sales', label: 'Amort. ventas', wPct: 0.095, align: 'right' },
      { key: 'amortized', label: 'Amort. total', wPct: 0.095, align: 'right' },
      { key: 'interest', label: 'Intereses', wPct: 0.085, align: 'right' },
      { key: 'paid', label: 'Pagado banco', wPct: 0.095, align: 'right' },
      { key: 'pending', label: 'Pendiente', wPct: 0.09, align: 'right' }
    ], { fontSize: 7 });

    for (const line of (phase.loanLines || [])) {
      if (!(line.entries || []).length) continue;
      financePdfEnsureSpace(pdf, 50 + 25 + (Math.min((line.entries || []).length + 1, 4) * 20));
      financePdfSection(pdf, `Movimientos - ${line.name}`);
      const sortedEntries = [...line.entries].sort((left, right) => {
        const leftDate = left.date ? new Date(left.date).getTime() : Number.MAX_SAFE_INTEGER;
        const rightDate = right.date ? new Date(right.date).getTime() : Number.MAX_SAFE_INTEGER;
        return leftDate - rightDate;
      });
      const movementRows = sortedEntries.map(entry => {
        const isDisbursement = entry.entryType === 'disbursement';
        const isPending = isDisbursement && entry.paymentStatus === 'pending';
        const bank = isDisbursement && !isPending && ['bank', 'mixed'].includes(entry.fundingParty || 'bank') ? toNum(entry.disbursementAmount) : 0;
        const promoter = isDisbursement && !isPending ? (entry.fundingParty === 'promoter' ? toNum(entry.disbursementAmount) : toNum(entry.promoterContributionAmount)) : 0;
        const pending = isPending ? toNum(entry.disbursementAmount) : 0;
        const amortized = toNum(entry.amortizedAmount);
        const interest = toNum(entry.interestAmount);
        const typeLabel = entry.entryType === 'sale_amortization' && entry.notes
          ? `${financeMovementLabel(entry)} · ${entry.notes}`
          : financeMovementLabel(entry);
        return {
          type: typeLabel,
          date: fmtDate(entry.date),
          origin: financeFundingLabel(entry.fundingParty),
          loan: entry.loanNumber || '-',
          bank: money(bank),
          promoter: money(promoter),
          requested: money(pending),
          amortized: money(amortized),
          interest: money(interest),
          paid: money(amortized + interest),
          status: financeMovementStatus(entry),
          _fill: entry.entryType === 'disbursement' ? '#DBEAFE'
            : entry.entryType === 'interest_payment' ? '#FEF3C7'
              : entry.entryType === 'sale_amortization' ? '#EDE9FE' : '#D1FAE5'
        };
      });
      const metric = phaseLines.find(item => item.line === line);
      if (metric) movementRows.push({
        type: 'TOTAL LÍNEA', date: '', origin: '', loan: '', bank: money(metric.bankDisbursed), promoter: money(metric.promoterContributed), requested: '',
        amortized: money(metric.amortized), interest: money(metric.interestPaid), paid: money(metric.totalPaidToBank), status: '', _fill: '#D1FAE5', _total: true
      });
      financePdfTable(pdf, movementRows, [
        { key: 'type', label: 'Tipo / detalle', wPct: 0.15 },
        { key: 'date', label: 'Fecha', wPct: 0.07 },
        { key: 'origin', label: 'Origen', wPct: 0.07 },
        { key: 'loan', label: 'Nº préstamo', wPct: 0.09 },
        { key: 'bank', label: 'Banco', wPct: 0.09, align: 'right' },
        { key: 'promoter', label: 'Promotor', wPct: 0.09, align: 'right' },
        { key: 'requested', label: 'Pendiente', wPct: 0.08, align: 'right' },
        { key: 'amortized', label: 'Amortización', wPct: 0.09, align: 'right' },
        { key: 'interest', label: 'Interés', wPct: 0.08, align: 'right' },
        { key: 'paid', label: 'Pago banco', wPct: 0.10, align: 'right' },
        { key: 'status', label: 'Estado', wPct: 0.09 }
      ], { fontSize: 6.8, rowHeight: 20 });
    }
  }

  const charts = chartsPayload || {};
  const chartEntries = Object.entries(charts).filter(([_, value]) => typeof value === 'string' && value);
  if (chartEntries.length) {
    pdf.addPage();
    financePdfHeader(pdf, { projectName, updatedAt, title: reportTitle });
    financePdfSection(pdf, 'Gráficas');
    for (const [title, source] of chartEntries) {
      const buffer = await urlToBuffer(source, req);
      if (!buffer) continue;
      financePdfEnsureSpace(pdf, 260);
      pdf.fontSize(11).fillColor('#0F172A').text(title);
      const imageTop = pdf.y + 6;
      pdf.image(buffer, pdf.page.margins.left, imageTop, { fit: [pdf.page.width - pdf.page.margins.left * 2, 220], align: 'center' });
      pdf.y = imageTop + 232;
    }
  }

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
      const commercialUnits = await getFinanceCommercialUnits(projectId, project.tenantKey);
      return exportFinanceXlsx({
        req, res, projectId, projectName, projectCurrency, updatedAt, doc, kpis, chartsPayload, phaseId: exportPhaseId, commercialUnits
      });
    }

    // pdf
    const commercialUnits = await getFinanceCommercialUnits(projectId, project.tenantKey);
    return exportFinancePdf({
      req, res, projectId, projectName, projectCurrency, updatedAt, doc, chartsPayload, phaseId: exportPhaseId, commercialUnits
    });

  } catch (err) {
    console.error('[FINANCE EXPORT] error:', err);
    res.status(500).json({ error: 'Error en exportación' });
  }
}

// ✅ Mantén compat con tu front actual
router.get('/projects/:projectId/finance/export', handleFinanceExport);
router.post('/projects/:projectId/finance/export', handleFinanceExport);

Object.defineProperty(router, '__financeExport', {
  value: { buildFinanceSnapshot, exportFinanceXlsx, exportFinancePdf, parseFinancePhaseWorkbook, uniqueFinanceUnitCandidates, selectFinanceUnitCandidate, financeUnitDisplayName, normalizeFinanceUnitAlias, financeImportedUsesWithFunding },
  enumerable: false
});

module.exports = router;
