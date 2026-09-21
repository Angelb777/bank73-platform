'use strict';

const Project = require('../models/Project');
const ProjectFinance = require('../models/ProjectFinance');
const ProjectPermit = require('../models/ProjectPermit');
const ProjectChecklist = require('../models/ProjectChecklist');
const Document = require('../models/Document');
const Unit = require('../models/Unit');
const Venta = require('../models/Venta');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const CommercialFolder = require('../models/CommercialFolder');
const Inspection = require('../models/Inspection');
const InspectionUnit = require('../models/InspectionUnit');
const InspectionEvidence = require('../models/InspectionEvidence');
const { buildFinanceControlSummary } = require('./financeReportContext');
const { buildPeriodActivity } = require('./reportActivity');

const CONTEXT_SCHEMA_VERSION = 2;

function plain(value) {
  if (value === null || value === undefined) return value;
  const source = typeof value.toObject === 'function' ? value.toObject() : value;
  return JSON.parse(JSON.stringify(source));
}

function number(value) {
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function optionalNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function unitStableKey(item = {}) {
  const ref = item.unitReferenceSnapshot || item;
  const code = String(ref.code || '').trim().toLowerCase();
  if (code) return `code:${code}`;
  const manzana = String(ref.manzana || '').trim().toLowerCase();
  const lote = String(ref.lote || '').trim().toLowerCase();
  return manzana || lote ? `lot:${manzana}:${lote}` : '';
}

function id(value) {
  return value ? String(value) : null;
}

function location(project = {}) {
  return {
    label: String(project.location || ''),
    address: String(project.address || ''),
    city: String(project.city || ''),
    province: String(project.province || ''),
    coordinates: plain(project.coordinates || { lat: null, lng: null })
  };
}

function inspectionSummary(inspection) {
  if (!inspection) return null;
  return {
    id: id(inspection._id),
    sequence: number(inspection.sequence),
    status: inspection.status,
    inspectionDate: inspection.inspectionDate,
    startedAt: inspection.startedAt,
    finalizedAt: inspection.finalizedAt || null,
    reportNumber: String(inspection.reportNumber || ''),
    physicalProgressPercent: number(inspection.projectProgressPercent),
    generalObservations: String(inspection.generalObservations || ''),
    commonAreas: plain(inspection.commonAreas || []),
    workFronts: plain(inspection.workFronts || []),
    incidents: plain(inspection.incidents || []),
    qualityObservations: String(inspection.qualityObservations || ''),
    environmentalObservations: String(inspection.environmentalObservations || ''),
    qualityAssessment: plain(inspection.qualityAssessment || null),
    environmentalAssessment: plain(inspection.environmentalAssessment || null),
    scheduleAssessment: plain(inspection.scheduleAssessment || null),
    technicalConclusion: String(inspection.technicalConclusion || ''),
    technicalRecommendation: plain(inspection.technicalRecommendation || null)
  };
}

function periodBetween(previousInspection, until) {
  const start = previousInspection?.finalizedAt || previousInspection?.inspectionDate;
  if (!start || !until) return null;
  const fromDate = new Date(start);
  const toDate = new Date(until);
  if (!Number.isFinite(fromDate.getTime()) || !Number.isFinite(toDate.getTime())) return null;
  return {
    from: fromDate.toISOString().slice(0, 10),
    to: toDate.toISOString().slice(0, 10),
    start: fromDate,
    end: toDate,
    label: `${fromDate.toISOString().slice(0, 10)} - ${toDate.toISOString().slice(0, 10)}`
  };
}

async function findPreviousFinalizedInspection(scope, before, excludeInspectionId) {
  const filter = {
    bankTenantKey: scope.bankTenantKey,
    projectTenantKey: scope.projectTenantKey,
    projectId: scope.projectId,
    status: 'finalized',
    deletedAt: null
  };
  if (excludeInspectionId) filter._id = { $ne: excludeInspectionId };
  if (before) filter.finalizedAt = { $lt: before };
  return Inspection.findOne(filter).sort({ finalizedAt: -1, inspectionDate: -1, createdAt: -1 }).lean();
}

function phaseDto(phase, at) {
  const start = phase.startDate ? new Date(phase.startDate) : null;
  const end = phase.endDate ? new Date(phase.endDate) : null;
  const active = !phase.isCompleted && (!start || start <= at) && (!end || end >= at);
  return {
    id: id(phase._id),
    name: String(phase.name || ''),
    startDate: phase.startDate || null,
    endDate: phase.endDate || null,
    actualStartDate: phase.actualStartDate || null,
    actualEndDate: phase.actualEndDate || null,
    isCompleted: !!phase.isCompleted,
    active,
    plannedUses: (phase.planUses || []).map(item => ({ name: item.name, amount: number(item.amount) })),
    actualUses: (phase.uses || []).map(item => ({ name: item.name, amount: number(item.amount) })),
    expectedDisbursement: number(phase.disbExpected),
    actualDisbursement: number(phase.disbActual),
    actualDisbursementAt: phase.disbActualAt || null
  };
}

function documentDto(document) {
  return {
    id: id(document._id),
    title: String(document.title || document.originalname || ''),
    originalname: String(document.originalname || ''),
    folder: String(document.folder || ''),
    subfolder: String(document.subfolder || ''),
    department: String(document.department || ''),
    category: String(document.category || ''),
    mimetype: String(document.mimetype || ''),
    status: String(document.status || ''),
    expiryDate: document.expiryDate || null,
    createdAt: document.createdAt || null,
    requirementId: id(document.requirementId),
    financePhaseId: id(document.financePhaseId),
    permitCode: String(document.permitCode || '')
  };
}

async function buildBaseSnapshot({ scope, inspectionDate = new Date(), excludeInspectionId = null }) {
  const project = await Project.findOne({ _id: scope.projectId, tenantKey: scope.projectTenantKey }).lean();
  if (!project) return null;

  const previousInspection = await findPreviousFinalizedInspection(scope, inspectionDate, excludeInspectionId);
  const [finance, permitRecords, checklists, documents, units, folders, promoter, bankTenant, technicalUsers, sequenceBase] = await Promise.all([
    ProjectFinance.findOne({ project: scope.projectId, tenantKey: scope.projectTenantKey }).lean(),
    ProjectPermit.find({ projectId: scope.projectId, tenantKey: scope.projectTenantKey }).lean(),
    ProjectChecklist.find({ projectId: scope.projectId, $or: [{ tenantKey: scope.projectTenantKey }, { tenantKey: { $exists: false } }] }).lean(),
    Document.find({ projectId: scope.projectId, tenantKey: scope.projectTenantKey, status: { $ne: 'REPLACED' } }).sort({ createdAt: -1 }).lean(),
    Unit.find({ projectId: scope.projectId, tenantKey: scope.projectTenantKey, deletedAt: null }).lean(),
    CommercialFolder.find({ projectId: scope.projectId, tenantKey: scope.projectTenantKey }).sort({ order: 1, createdAt: 1 }).lean(),
    project.assignedPromoters?.[0] ? User.findById(project.assignedPromoters[0]).select('name email promoterProfile promoterCategory').lean() : null,
    Tenant.findOne({ tenantKey: scope.bankTenantKey }).select('tenantKey name').lean(),
    User.find({ _id: { $in: project.assignedTecnicos || [] } }).select('name email professionalProfile').lean(),
    Inspection.countDocuments({ bankTenantKey: scope.bankTenantKey, projectTenantKey: scope.projectTenantKey, projectId: scope.projectId, deletedAt: null })
  ]);

  const phaseSource = finance?.phases?.length ? finance.phases : (project.financePhases || []);
  const phases = phaseSource.map(phase => phaseDto(phase, new Date(inspectionDate)));
  const permitItems = permitRecords.flatMap(record => (record.items || []).map(item => ({
    id: id(item._id), code: String(item.code || ''), title: String(item.title || ''), institution: String(item.institution || ''),
    type: String(item.type || ''), status: String(item.status || ''), dueDate: item.dueDate || null,
    submittedAt: item.submittedAt || null, resolvedAt: item.resolvedAt || null, notes: String(item.notes || ''),
    updatedAt: item.updatedAt || record.updatedAt, createdAt: item.createdAt || record.createdAt
  })));
  const financeControl = buildFinanceControlSummary(finance || {}, project);
  const administrativeProgressPercent = checklists.length
    ? Math.round(checklists.reduce((sum, item) => {
      const subtasks = item.subtasks || [];
      return sum + (subtasks.length ? subtasks.filter(subtask => subtask.completed).length / subtasks.length * 100 : item.status === 'COMPLETADO' ? 100 : item.status === 'EN_PROCESO' ? 50 : 0);
    }, 0) / checklists.length)
    : 0;
  const previousScope = previousInspection ? {
    bankTenantKey: scope.bankTenantKey,
    projectTenantKey: scope.projectTenantKey,
    projectId: scope.projectId,
    inspectionId: previousInspection._id
  } : null;
  const [previousEvidence, previousUnits] = previousScope ? await Promise.all([
    InspectionEvidence.find(previousScope).sort({ createdAt: 1 }).lean(),
    InspectionUnit.find(previousScope).sort({ createdAt: 1 }).lean()
  ]) : [[], []];
  const period = periodBetween(previousInspection, inspectionDate);
  const ventas = period ? await Venta.find({ projectId: scope.projectId, tenantKey: scope.projectTenantKey }).lean() : [];
  const activity = buildPeriodActivity({ period, ventas, documents, checklists, permits: permitItems, financePhases: phaseSource });
  const previousPhysical = number(previousInspection?.projectProgressPercent);
  const previousFrontByKey = new Map((previousInspection?.workFronts || []).map(front => [String(front.key), front]));

  return plain({
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    capturedAt: new Date(),
    sourceScope: { bankTenantKey: scope.bankTenantKey, projectTenantKey: scope.projectTenantKey, projectId: id(scope.projectId) },
    sourceVersions: { projectUpdatedAt: project.updatedAt || null, financeUpdatedAt: finance?.updatedAt || null },
    project: {
      id: id(project._id), name: String(project.name || ''), description: String(project.description || ''),
      type: String(project.projectType || ''), status: String(project.status || ''), currency: String(project.currency || 'PAB'),
      location: location(project), legal: project.legalData || {}, technical: project.technicalData || {}, housingModels: project.housingModels || []
    },
    participants: {
      bank: { tenantKey: scope.bankTenantKey, name: String(bankTenant?.name || scope.bankTenantKey) },
      promoter: promoter ? { id: id(promoter._id), name: String(project.legalData?.promoterLegalName || promoter.promoterProfile?.companyName || promoter.name || ''), email: String(promoter.email || ''), category: String(promoter.promoterCategory || ''), profile: promoter.promoterProfile || {} } : null,
      technicalTeam: technicalUsers.map(user => ({ id: id(user._id), name: String(user.name || ''), email: String(user.email || ''), professional: plain(user.professionalProfile || {}) })),
      suggestedTeam: plain(project.teamSuggestion || {})
    },
    finance: {
      summary: financeControl.totals,
      financialConditions: project.financialConditions || {},
      phases,
      loanLines: financeControl.loanLines,
      unitAmortizations: financeControl.unitAmortizations,
      plannedDisbursements: finance?.disbursements?.planned || [],
      actualDisbursements: finance?.disbursements?.actual || []
    },
    planning: {
      phases,
      activeFronts: phases.filter(phase => phase.active),
      workFronts: [
        ...phases.map(phase => {
          const key = `phase:${phase.id}`;
          const prior = previousFrontByKey.get(key);
          const previousPercent = optionalNumber(prior?.currentProgressPercent);
          return { key, sourceType: 'phase', sourceId: phase.id, name: phase.name, active: phase.active, plannedStartDate: phase.startDate, plannedEndDate: phase.endDate, previousPercent, previousKnown: previousPercent !== null, plannedPercent: prior?.plannedProgressPercent ?? null };
        }),
        ...folders.map(folder => {
          const key = `folder:${id(folder._id)}`;
          const prior = previousFrontByKey.get(key);
          const previousPercent = optionalNumber(prior?.currentProgressPercent);
          return { key, sourceType: 'folder', sourceId: id(folder._id), name: folder.name, active: true, plannedStartDate: null, plannedEndDate: null, previousPercent, previousKnown: previousPercent !== null, plannedPercent: prior?.plannedProgressPercent ?? null };
        })
      ]
    },
    compliance: {
      permits: permitItems,
      requirements: phaseSource.flatMap(phase => (phase.requirements || []).map(requirement => ({ ...plain(requirement), phaseId: id(phase._id), phaseName: phase.name }))),
      documents: documents.map(documentDto),
      policies: project.technicalData?.insurancePolicies || []
    },
    inventory: {
      models: project.housingModels || [],
      folders: folders.map(folder => ({ _id: id(folder._id), id: id(folder._id), name: folder.name, color: folder.color, order: number(folder.order) })),
      units: units.map(unit => ({ id: id(unit._id), code: unit.code || '', manzana: unit.manzana || '', lote: unit.lote || '', model: unit.modelo || '', status: unit.estado || '', folderId: id(unit.folderId) }))
    },
    history: {
      sequence: sequenceBase + (excludeInspectionId ? 0 : 1),
      previousInspection: inspectionSummary(previousInspection),
      previousInspectionId: id(previousInspection?._id),
      previousPhysicalProgressPercent: previousPhysical,
      previousFindings: previousInspection ? { generalObservations: previousInspection.generalObservations || '', technicalRecommendation: previousInspection.technicalRecommendation || null } : null,
      previousCommonAreas: previousInspection?.commonAreas || [],
      previousUnits: previousUnits.map(plain),
      previousFinancialSummary: plain(previousInspection?.reportSnapshot?.finance?.summary || null),
      previousPhotos: previousEvidence.map(item => ({ id: id(item._id), unitId: id(item.unitId), commonAreaKey: item.commonAreaKey || '', caption: item.caption || '', createdAt: item.createdAt, filePath: `/api/mobile/v1/inspections/${item.inspectionId}/evidence/${item._id}/file` }))
    },
    activitySincePreviousInspection: activity,
    metrics: {
      administrativeProgress: { percent: administrativeProgressPercent, source: 'project_checklist' },
      physicalProgress: { previousPercent: previousPhysical, currentPercent: null, periodIncrementPercent: null, source: 'certified_inspections' },
      financialProgress: { percent: financeControl.totals.budgetApproved > 0 ? financeControl.totals.totalDisbursed / financeControl.totals.budgetApproved * 100 : 0, source: 'project_finance' },
      scheduleProgress: { plannedPercent: null, variancePercent: null, source: 'project_program' }
    },
    pendingIssues: (previousInspection?.incidents || []).filter(item => item.status !== 'resolved').map(plain),
    dataAvailability: {
      finance: !!finance,
      previousInspection: !!previousInspection,
      permits: permitItems.length > 0,
      requirements: phaseSource.some(phase => (phase.requirements || []).length > 0),
      policies: (project.technicalData?.insurancePolicies || []).length > 0,
      units: units.length > 0
    }
  });
}

async function buildInspectionReportContext({ scope, inspection, preferFrozen = true }) {
  if (preferFrozen && inspection?.status === 'finalized' && inspection?.reportSnapshot) return plain(inspection.reportSnapshot);
  const base = inspection?.startSnapshot || await buildBaseSnapshot({ scope, inspectionDate: inspection?.startedAt || new Date(), excludeInspectionId: inspection?._id });
  if (!base) return null;
  const [units, evidence] = inspection ? await Promise.all([
    InspectionUnit.find({ bankTenantKey: scope.bankTenantKey, projectTenantKey: scope.projectTenantKey, projectId: scope.projectId, inspectionId: inspection._id }).sort({ createdAt: 1 }).lean(),
    InspectionEvidence.find({ bankTenantKey: scope.bankTenantKey, projectTenantKey: scope.projectTenantKey, projectId: scope.projectId, inspectionId: inspection._id }).sort({ createdAt: 1 }).lean()
  ]) : [[], []];
  const previous = number(base.history?.previousPhysicalProgressPercent);
  const current = inspection ? number(inspection.projectProgressPercent) : null;
  const context = plain(base);
  context.generatedAt = new Date();
  context.inspection = inspectionSummary(inspection);
  context.inspectionUnits = units.map(plain);
  context.photos = evidence.map(item => ({ ...plain(item), id: id(item._id), filePath: `/api/mobile/v1/inspections/${item.inspectionId}/evidence/${item._id}/file` }));
  context.visit = {
    generalObservations: String(inspection?.generalObservations || ''),
    changes: (inspection?.incidents || []).filter(item => item.type === 'change').map(plain),
    incidents: plain(inspection?.incidents || []),
    qualityFindings: (inspection?.incidents || []).filter(item => item.type === 'quality' || item.type === 'defect').map(plain),
    environmentalFindings: (inspection?.incidents || []).filter(item => item.type === 'environment').map(plain),
    qualityObservations: String(inspection?.qualityObservations || ''),
    environmentalObservations: String(inspection?.environmentalObservations || ''),
    qualityAssessment: plain(inspection?.qualityAssessment || null),
    environmentalAssessment: plain(inspection?.environmentalAssessment || null),
    scheduleAssessment: plain(inspection?.scheduleAssessment || null),
    conclusion: String(inspection?.technicalConclusion || ''),
    recommendation: plain(inspection?.technicalRecommendation || null)
  };
  context.metrics.physicalProgress.currentPercent = current;
  context.metrics.physicalProgress.periodIncrementPercent = current === null ? null : Math.round((current - previous) * 10000) / 10000;
  const previousUnitsById = new Map((context.history?.previousUnits || []).map(item => [id(item.unitId), item]));
  const previousUnitsByStableKey = new Map((context.history?.previousUnits || []).map(item => [unitStableKey(item), item]).filter(([key]) => key));
  context.unitProgressComparisons = units.map(item => {
    const previousItem = previousUnitsById.get(id(item.unitId)) || previousUnitsByStableKey.get(unitStableKey(item));
    const previousPercent = optionalNumber(previousItem?.progressPercent);
    const currentPercent = number(item.progressPercent);
    return {
      unitId: id(item.unitId),
      reference: plain(item.unitReferenceSnapshot || previousItem?.unitReferenceSnapshot || {}),
      previousPercent,
      currentPercent,
      previousKnown: previousPercent !== null,
      periodIncrementPercent: previousPercent === null ? null : Math.round((currentPercent - previousPercent) * 10000) / 10000
    };
  });
  const previousAreasByKey = new Map((context.history?.previousCommonAreas || []).map(area => [String(area.key), area]));
  const commonAreaFronts = (inspection?.commonAreas || []).map(area => {
    const previousArea = previousAreasByKey.get(String(area.key));
    const previousPercent = optionalNumber(previousArea?.progressPercent);
    const currentPercent = number(area.progressPercent);
    return {
      key: `common-area:${area.key}`,
      sourceType: 'common_area',
      sourceId: String(area.key),
      name: String(area.name || ''),
      active: true,
      previousPercent,
      plannedPercent: null,
      currentPercent,
      previousKnown: previousPercent !== null,
      periodIncrementPercent: previousPercent === null ? null : Math.round((currentPercent - previousPercent) * 10000) / 10000,
      status: '',
      observation: String(area.observations || '')
    };
  });
  const savedFrontsByKey = new Map((inspection?.workFronts || []).map(front => [String(front.key), front]));
  const plannedFrontKeys = new Set((context.planning?.workFronts || []).map(front => String(front.key)));
  context.workFronts = [
    ...(context.planning?.workFronts || []).map(front => {
      const saved = savedFrontsByKey.get(String(front.key));
      const explicitUnknown = saved?.previousProgressKnown === false;
      const previousPercent = explicitUnknown ? null : optionalNumber(saved?.previousProgressPercent ?? front.previousPercent);
      const currentPercent = number(saved?.currentProgressPercent ?? previousPercent ?? 0);
      return { ...front, previousPercent, previousKnown: previousPercent !== null, plannedPercent: saved?.plannedProgressPercent ?? front.plannedPercent ?? null, currentPercent, periodIncrementPercent: previousPercent === null ? null : Math.round((currentPercent - previousPercent) * 10000) / 10000, status: String(saved?.status || 'not_visited'), observation: String(saved?.observations || '') };
    }),
    ...(inspection?.workFronts || []).filter(front => !plannedFrontKeys.has(String(front.key))).map(front => ({
      key: String(front.key), sourceType: String(front.sourceType || 'custom'), sourceId: String(front.sourceId || ''), name: String(front.name || ''), active: true,
      previousPercent: front.previousProgressKnown === false ? null : optionalNumber(front.previousProgressPercent), previousKnown: front.previousProgressKnown !== false && optionalNumber(front.previousProgressPercent) !== null, plannedPercent: front.plannedProgressPercent == null ? null : number(front.plannedProgressPercent), currentPercent: number(front.currentProgressPercent),
      periodIncrementPercent: front.previousProgressKnown === false || optionalNumber(front.previousProgressPercent) === null ? null : Math.round((number(front.currentProgressPercent) - number(front.previousProgressPercent)) * 10000) / 10000,
      status: String(front.status || 'not_visited'), observation: String(front.observations || '')
    })),
    ...commonAreaFronts
  ];
  context.signature = inspection?.signature ? plain(inspection.signature) : null;
  if (inspection?.avaluadorId && User.db.readyState === 1) {
    const evaluator = await User.findById(inspection.avaluadorId).select('name email professionalProfile').lean();
    if (evaluator) {
      context.evaluator = {
        name: String(evaluator.name || ''),
        email: String(evaluator.email || ''),
        professional: plain(evaluator.professionalProfile || {})
      };
    }
  }
  const previousFinancial = context.history?.previousFinancialSummary;
  const currentFinancial = context.finance?.summary || {};
  const financialFields = ['totalDisbursed', 'totalAmortized', 'currentDebtBalance', 'promoterContribution'];
  context.metrics.financialComparison = Object.fromEntries(financialFields.map(field => {
    const prior = optionalNumber(previousFinancial?.[field]);
    const accumulated = optionalNumber(currentFinancial?.[field]);
    return [field, {
      previous: prior,
      period: prior === null || accumulated === null ? null : accumulated - prior,
      accumulated
    }];
  }));
  const plannedProgress = optionalNumber(inspection?.scheduleAssessment?.plannedProgressPercent);
  context.metrics.scheduleProgress = {
    plannedPercent: plannedProgress,
    actualPercent: current,
    variancePercent: plannedProgress === null || current === null ? null : Math.round((current - plannedProgress) * 10000) / 10000,
    source: 'inspection_assessment'
  };
  context.audit = {
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    inspectionId: id(inspection?._id),
    assignmentId: id(inspection?.assignmentId),
    avaluadorId: id(inspection?.avaluadorId),
    snapshotCapturedAt: base.capturedAt,
    finalizedAt: inspection?.finalizedAt || null
  };
  return context;
}

function inspectionPackDto(context) {
  return {
    schemaVersion: context.schemaVersion,
    project: context.project,
    bank: context.participants?.bank || null,
    promoter: context.participants?.promoter || null,
    inspection: context.inspection,
    sequence: context.history?.sequence || 1,
    previousInspection: context.history?.previousInspection || null,
    metrics: context.metrics,
    budget: context.finance?.summary || {},
    financing: {
      financialConditions: context.finance?.financialConditions || {},
      loanLines: context.finance?.loanLines || [],
      plannedDisbursements: context.finance?.plannedDisbursements || [],
      actualDisbursements: context.finance?.actualDisbursements || []
    },
    activeFronts: context.planning?.activeFronts || [],
    workFronts: context.workFronts || context.planning?.workFronts || [],
    program: context.planning?.phases || [],
    compliance: context.compliance,
    pendingIssues: context.pendingIssues || [],
    changesSincePreviousInspection: context.activitySincePreviousInspection,
    previousPhotos: context.history?.previousPhotos || [],
    inventory: context.inventory,
    current: { visit: context.visit || {}, units: context.inspectionUnits || [], unitProgressComparisons: context.unitProgressComparisons || [], photos: context.photos || [], signature: context.signature || null },
    dataAvailability: context.dataAvailability,
    reportSections: ['cover', 'general', 'participants', 'finance', 'financial_summary', 'program', 'compliance', 'physical_progress', 'work_fronts', 'changes_incidents', 'quality_environment', 'conclusion', 'signature', 'economic_annex', 'photo_annex']
  };
}

module.exports = {
  CONTEXT_SCHEMA_VERSION,
  buildBaseSnapshot,
  buildInspectionReportContext,
  findPreviousFinalizedInspection,
  inspectionPackDto
};
