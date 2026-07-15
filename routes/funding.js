const express = require('express');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const Project = require('../models/Project');
const ProjectFunding = require('../models/ProjectFunding');
const FundingInterest = require('../models/FundingInterest');
const User = require('../models/User');
const Unit = require('../models/Unit');
const Venta = require('../models/Venta');
const ProjectPermit = require('../models/ProjectPermit');
const ProjectFinance = require('../models/ProjectFinance');
const Document = require('../models/Document');
const audit = require('../utils/audit');
const { calculateFundingScore } = require('../services/fundingScoring');
const { financingMetrics, averageProjectSalePrice } = require('../services/fundingMetrics');
const { opportunityFilterFor, applyPublicationAction } = require('../services/fundingPublication');
const { moduleEnabled } = require('../services/moduleSettings');
const router = express.Router();
const ADMIN_STATUSES = ProjectFunding.FUNDING_STATUSES;
const INTEREST_STATUSES = FundingInterest.INTEREST_STATUSES;
const PUBLIC_FIELDS = new Set(['description','images','location','housingModels','units','prices','financialSummary','phases','score','conclusions','documents']);
const PORTFOLIO_SOLD_STATUSES = new Set([
  'reservado', 'con_cpp', 'tramite_legal_activado', 'escriturado_traspasado', 'vivienda_entregada',
  'en_escrituracion', 'escriturado', 'entregado'
]);
const role = req => String(req.user?.role || '').toLowerCase();
const uid = req => req.user?.userId || req.user?._id;
const isId = value => mongoose.Types.ObjectId.isValid(value);
const cleanText = (value, max = 3000) => String(value || '').trim().slice(0, max);
const money = value => Math.max(0, Number(value) || 0);
const canViewMarketplace = req => ['bank', 'admin'].includes(role(req));
const opportunityFilter = req => opportunityFilterFor({ role: role(req), tenantKey: req.tenantKey });

async function scoreFor(project, funding) {
  const promoterId = project.assignedPromoters?.[0];
  const [promoter, permits, units, sales, finance] = await Promise.all([
    promoterId ? User.findById(promoterId).select('promoterProfile promoterCategory').lean() : null,
    ProjectPermit.find({ projectId: project._id, tenantKey: project.tenantKey }).lean(),
    Unit.find({ projectId: project._id, $or: [{ tenantKey: project.tenantKey }, { tenantKey: { $exists: false } }] }).lean(),
    Venta.find({ projectId: project._id, $or: [{ tenantKey: project.tenantKey }, { tenantKey: { $exists: false } }] }).lean(),
    ProjectFinance.findOne({ project: project._id, tenantKey: project.tenantKey }).lean()
  ]);
  return calculateFundingScore({ project, promoter: promoter || {}, permits, units, sales, finance: finance || {}, requestedAmount: funding?.requestedAmount });
}

async function ensureFunding(project) {
  let funding = await ProjectFunding.findOne({ project: project._id });
  if (!funding) funding = await ProjectFunding.create({ tenantKey: project.tenantKey, project: project._id });
  return funding;
}

function requestMetrics(funding = {}, metrics = {}) {
  const hasExactRequest = funding.requestedAmount !== undefined && funding.requestedAmount !== null;
  const requestedAmount = hasExactRequest ? money(funding.requestedAmount) : money(metrics.requestedAmount);
  const securedRequestAmount = Math.min(requestedAmount, money(funding.securedRequestAmount));
  return {
    requestedAmount,
    securedRequestAmount,
    requestPendingAmount: Math.max(0, requestedAmount - securedRequestAmount),
    requestCoveredPct: requestedAmount ? securedRequestAmount / requestedAmount * 100 : 0
  };
}

function summarizeOpportunityUnits(units = [], project = {}) {
  const summary = { unitsTotal: 0, unitsSold: 0, presalesPct: 0, potentialSalesValue: 0 };
  (units || []).forEach(unit => {
    summary.unitsTotal += 1;
    summary.potentialSalesValue += money(unit.precioLista);
    const status = String(unit.estado ?? unit.status ?? '').toLowerCase();
    if (PORTFOLIO_SOLD_STATUSES.has(status)) summary.unitsSold += 1;
  });
  if (!summary.potentialSalesValue) {
    summary.potentialSalesValue = (project.housingModels || []).reduce(
      (sum, model) => sum + money(model.price) * Math.max(0, Number(model.unitsCount) || 0),
      0
    );
  }
  summary.presalesPct = summary.unitsTotal ? summary.unitsSold / summary.unitsTotal * 100 : 0;
  return summary;
}

function publicDto(project, funding, finance = {}, { detail = false } = {}) {
  const fields = new Set(funding.publicFields || []);
  const metrics = financingMetrics(project, finance);
  const request = requestMetrics(funding, metrics);
  const phases = Array.isArray(finance?.phases) && finance.phases.length ? finance.phases : (project.financePhases || []);
  const dto = {
    _id: funding._id, projectId: project._id, name: project.name, projectType: project.projectType || '',
    status: project.status, currency: project.currency || 'PAB', coverImage: project.coverImage || null,
    totalCost: metrics.totalCost, alreadyFinanced: metrics.alreadyFinanced, coveredAmount: metrics.alreadyFinanced,
    pendingProjectAmount: metrics.pendingAmount, pendingAmount: request.requestPendingAmount,
    financedPct: metrics.financedPct, requestedAmount: request.requestedAmount,
    securedRequestAmount: request.securedRequestAmount, requestPendingAmount: request.requestPendingAmount,
    requestCoveredPct: request.requestCoveredPct,
    estimatedTerm: metrics.estimatedTerm, phaseNames: metrics.phaseNames,
    fundingDeadline: funding.fundingDeadline || null,
    finalScore: funding.finalScore ?? funding.automaticScore
  };
  if (!detail) return dto;
  if (fields.has('description')) dto.description = project.description || '';
  if (fields.has('location')) dto.location = project.city || project.province || project.location || '';
  if (fields.has('housingModels')) dto.housingModels = project.housingModels || [];
  if (fields.has('financialSummary')) dto.financialSummary = { projectTotal: metrics.totalCost, promoterContribution: metrics.promoterContribution, otherSources: metrics.otherSources, approvedBankFinancing: metrics.approvedBankFinancing, disbursedAmount: metrics.disbursedAmount, requestedAmount: request.requestedAmount, securedRequestAmount: request.securedRequestAmount, requestPendingAmount: request.requestPendingAmount, alreadyFinanced: metrics.alreadyFinanced, pendingProjectAmount: metrics.pendingAmount };
  if (fields.has('phases')) dto.phases = phases.map(p => ({ _id: p._id, name: p.name, startDate: p.startDate, endDate: p.endDate }));
  if (fields.has('conclusions')) dto.publicConclusions = funding.publicConclusions || '';
  return dto;
}

router.get('/module-settings', async (_req, res) => {
  try {
    res.json({ enabled: await moduleEnabled('funding') });
  } catch (_error) {
    res.json({ enabled: false });
  }
});

router.get('/admin', async (req, res) => {
  if (role(req) !== 'admin') return res.status(403).json({ error: 'Acceso solo para superadmin' });
  const projects = await Project.find({ tenantKey: req.tenantKey, seeksFinancing: true }).sort({ createdAt: -1 }).lean();
  const projectIds = projects.map(p => p._id);
  const [fundings, finances, units] = await Promise.all([
    ProjectFunding.find({ project: { $in: projectIds } }).lean(),
    ProjectFinance.find({ project: { $in: projectIds }, tenantKey: req.tenantKey }).lean(),
    Unit.find({ projectId: { $in: projectIds }, $and: [{ $or: [{ tenantKey: req.tenantKey }, { tenantKey: { $exists: false } }] }, { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] }] }).select('projectId precioLista').lean()
  ]);
  const byProject = new Map(fundings.map(f => [String(f.project), f]));
  const financeByProject = new Map(finances.map(f => [String(f.project), f]));
  const unitsByProject = new Map();
  units.forEach(unit => {
    const key = String(unit.projectId);
    if (!unitsByProject.has(key)) unitsByProject.set(key, []);
    unitsByProject.get(key).push(unit);
  });
  const interests = await FundingInterest.find({ projectTenantKey: req.tenantKey, project: { $in: projectIds } })
    .select('project bankName bankTenantKey amount comment status notificationPending notificationReviewedAt createdAt')
    .sort({ createdAt: -1 })
    .lean();
  const interestsByProject = new Map();
  const pendingCounts = new Map();
  interests.forEach(interest => {
    const key = String(interest.project);
    if (!interestsByProject.has(key)) interestsByProject.set(key, []);
    interestsByProject.get(key).push(interest);
    const pending = interest.notificationPending !== false && !['accepted', 'rejected', 'closed'].includes(interest.status);
    if (pending) pendingCounts.set(key, (pendingCounts.get(key) || 0) + 1);
  });
  res.json(projects.map(p => {
    const stored = byProject.get(String(p._id));
    const projectInterests = interestsByProject.get(String(p._id)) || [];
    return { ...publicDto(p, stored || { publicFields: [] }, financeByProject.get(String(p._id)) || {}), publishStatus: p.publishStatus, fundingStatus: stored?.status || 'pending_review', automaticScore: stored?.automaticScore || 0, finalScore: stored?.finalScore ?? null, marketAnalysis: { ...(stored?.marketAnalysis || {}), averageProjectSalePrice: averageProjectSalePrice(p, unitsByProject.get(String(p._id)) || []) }, interestCount: projectInterests.length, pendingNotificationCount: pendingCounts.get(String(p._id)) || 0 };
  }));
});

router.get('/admin/:projectId', async (req, res) => {
  if (role(req) !== 'admin') return res.status(403).json({ error: 'Acceso solo para superadmin' });
  const project = await Project.findOne({ _id: req.params.projectId, tenantKey: req.tenantKey }).lean();
  if (!project || !project.seeksFinancing) return res.status(404).json({ error: 'Solicitud no encontrada' });
  const funding = await ensureFunding(project);
  const promoterId = project.assignedPromoters?.[0];
  const [interests, documents, finance, units, promoter, publishedByUser] = await Promise.all([
    FundingInterest.find({ project: project._id, projectTenantKey: req.tenantKey }).sort({ createdAt: -1 }).lean(),
    Document.find({ projectId: project._id, tenantKey: project.tenantKey }).select('originalname title mimetype size').sort({ createdAt: -1 }).lean(),
    ProjectFinance.findOne({ project: project._id, tenantKey: project.tenantKey }).lean(),
    Unit.find({ projectId: project._id, $and: [{ $or: [{ tenantKey: project.tenantKey }, { tenantKey: { $exists: false } }] }, { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] }] }).select('precioLista').lean(),
    promoterId ? User.findById(promoterId).select('name companyName promoterProfile promoterCategory').lean() : null,
    funding.publishedBy ? User.findById(funding.publishedBy).select('name email').lean() : null
  ]);
  const derivedAverageSalePrice = averageProjectSalePrice(project, units);
  const metrics = financingMetrics(project, finance || {});
  const request = requestMetrics(funding.toObject ? funding.toObject() : funding, metrics);
  const financialSummary = {
    totalCost: metrics.totalCost,
    promoterContribution: metrics.promoterContribution,
    otherSources: metrics.otherSources,
    approvedBankFinancing: metrics.approvedBankFinancing,
    disbursedAmount: metrics.disbursedAmount,
    coveredAmount: metrics.alreadyFinanced,
    pendingProjectAmount: metrics.pendingAmount,
    financedPct: metrics.financedPct,
    ...request
  };
  res.json({ project, funding, finance, interests, documents, promoter, publishedByUser, financialSummary, derivedAverageSalePrice });
});

router.post('/admin/:projectId/recalculate', async (req, res) => {
  if (role(req) !== 'admin') return res.status(403).json({ error: 'Acceso solo para superadmin' });
  const project = await Project.findOne({ _id: req.params.projectId, tenantKey: req.tenantKey }).lean();
  if (!project?.seeksFinancing) return res.status(404).json({ error: 'Solicitud no encontrada' });
  const funding = await ensureFunding(project);
  const result = await scoreFor(project, funding);
  const manualByKey = new Map((funding.scoreBreakdown || []).filter(item => item.manualScore !== null).map(item => [item.key, item.manualScore]));
  result.scoreBreakdown.forEach(item => { if (manualByKey.has(item.key)) item.manualScore = manualByKey.get(item.key); });
  funding.automaticScore = result.automaticScore;
  funding.scoreVersion = result.scoreVersion;
  funding.scoreBreakdown = result.scoreBreakdown;
  await funding.save();
  res.json(funding);
});

router.patch('/admin/:projectId', async (req, res) => {
  if (role(req) !== 'admin') return res.status(403).json({ error: 'Acceso solo para superadmin' });
  const project = await Project.findOne({ _id: req.params.projectId, tenantKey: req.tenantKey }).lean();
  if (!project?.seeksFinancing) return res.status(404).json({ error: 'Solicitud no encontrada' });
  const funding = await ensureFunding(project);
  const publicationAction = cleanText(req.body.publicationAction, 30);
  if (req.body.requestedAmount !== undefined) {
    const requestedAmount = money(req.body.requestedAmount);
    if (!requestedAmount) return res.status(400).json({ error: 'El monto exacto solicitado debe ser mayor que cero' });
    const totalCost = financingMetrics(project, {}).totalCost;
    if (requestedAmount > totalCost) return res.status(400).json({ error: 'El monto solicitado no puede superar el coste total' });
    funding.requestedAmount = requestedAmount;
  }
  if (req.body.securedRequestAmount !== undefined) funding.securedRequestAmount = money(req.body.securedRequestAmount);
  if (req.body.fundingDeadline !== undefined) {
    const parsedDeadline = req.body.fundingDeadline ? new Date(req.body.fundingDeadline) : null;
    if (!parsedDeadline || Number.isNaN(parsedDeadline.getTime())) return res.status(400).json({ error: 'La fecha límite de financiación no es válida' });
    funding.fundingDeadline = parsedDeadline;
  }
  if (funding.securedRequestAmount > funding.requestedAmount) return res.status(400).json({ error: 'Los fondos asegurados no pueden superar el monto solicitado' });
  if (req.body.status !== undefined) {
    if (!ADMIN_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Estado financiero inválido' });
    if (req.body.status === 'published' && funding.status !== 'published' && publicationAction !== 'publish') {
      return res.status(400).json({ error: 'Para publicar utiliza la acción Publicar; no basta con cambiar el estado' });
    }
    funding.status = req.body.status;
  }
  if (req.body.finalScore !== undefined) funding.finalScore = Math.max(0, Math.min(100, Number(req.body.finalScore) || 0));
  if (req.body.marketAssessment !== undefined) funding.marketAssessment = cleanText(req.body.marketAssessment);
  if (req.body.marketAnalysis && typeof req.body.marketAnalysis === 'object') {
    const units = await Unit.find({ projectId: project._id, $and: [{ $or: [{ tenantKey: project.tenantKey }, { tenantKey: { $exists: false } }] }, { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] }] }).select('precioLista').lean();
    const input = req.body.marketAnalysis;
    const income = money(input.targetHouseholdMonthlyIncome);
    const payment = money(input.estimatedMonthlyMortgagePayment);
    const referenceDate = input.referenceDate ? new Date(input.referenceDate) : null;
    funding.marketAnalysis = {
      targetHouseholdMonthlyIncome: income,
      averageProjectSalePrice: averageProjectSalePrice(project, units),
      estimatedMonthlyMortgagePayment: payment,
      paymentToIncomeRatio: income ? payment / income * 100 : 0,
      comparableProjectsAveragePrice: money(input.comparableProjectsAveragePrice),
      estimatedSalesVelocity: cleanText(input.estimatedSalesVelocity, 300),
      dataSource: cleanText(input.dataSource, 1000),
      referenceDate: referenceDate && !Number.isNaN(referenceDate.getTime()) ? referenceDate : null,
      marketScore: Math.max(0, Math.min(100, Number(input.marketScore) || 0)),
      analystComment: cleanText(input.analystComment)
    };
  }
  if (req.body.internalComments !== undefined) funding.internalComments = cleanText(req.body.internalComments);
  if (req.body.publicConclusions !== undefined) funding.publicConclusions = cleanText(req.body.publicConclusions);
  if (req.body.isVisibleToBanks !== undefined) funding.isVisibleToBanks = !!req.body.isVisibleToBanks;
  if (req.body.visibilityMode !== undefined) {
    if (!['all_banks', 'selected_tenants'].includes(req.body.visibilityMode)) return res.status(400).json({ error: 'Modalidad de visibilidad inválida' });
    funding.visibilityMode = req.body.visibilityMode;
  }
  if (Array.isArray(req.body.visibleToTenantKeys)) funding.visibleToTenantKeys = [...new Set(req.body.visibleToTenantKeys.map(v => cleanText(v, 100)).filter(Boolean))];
  if (Array.isArray(req.body.publicFields)) funding.publicFields = [...new Set(req.body.publicFields.filter(v => PUBLIC_FIELDS.has(v)))];
  if (Array.isArray(req.body.publicDocumentIds)) {
    const ids = req.body.publicDocumentIds.filter(isId);
    const docs = await Document.find({ _id: { $in: ids }, projectId: project._id, tenantKey: project.tenantKey }).select('_id').lean();
    funding.publicDocumentIds = docs.map(doc => doc._id);
  }
  if (Array.isArray(req.body.scoreBreakdown)) {
    const overrides = new Map(req.body.scoreBreakdown.map(i => [String(i.key), i.manualScore]));
    funding.scoreBreakdown.forEach(item => {
      if (!overrides.has(item.key)) return;
      const value = overrides.get(item.key);
      item.manualScore = value === null ? null : Math.max(0, Math.min(item.maxScore, Number(value) || 0));
    });
  }
  if (publicationAction === 'publish' && project.publishStatus !== 'approved') {
    return res.status(400).json({ error: 'El proyecto debe estar aprobado en el portfolio ordinario antes de publicarlo en el marketplace' });
  }
  if (publicationAction === 'publish' && !money(funding.requestedAmount)) {
    return res.status(400).json({ error: 'Indica el monto solicitado antes de publicar' });
  }
  if (!publicationAction && req.body.isVisibleToBanks === true && !(
    ['published', 'partially_funded'].includes(funding.status) || (funding.status === 'approved' && !!funding.publishedAt)
  )) {
    return res.status(400).json({ error: 'La visibilidad solo se activa al publicar la oportunidad. Revisa los requisitos y pulsa Publicar' });
  }
  try {
    applyPublicationAction(funding, publicationAction, { userId: uid(req) });
  } catch (error) {
    return res.status(error.status || 400).json({ error: error.message });
  }
  if (funding.visibilityMode === 'selected_tenants' && !funding.visibleToTenantKeys.length) {
    return res.status(400).json({ error: 'Selecciona al menos un tenant bancario para esta modalidad' });
  }
  funding.reviewedBy = uid(req); funding.reviewedAt = new Date();
  await funding.save();
  await audit(req, publicationAction === 'publish' ? 'funding.published' : publicationAction === 'withdraw' ? 'funding.withdrawn' : 'funding.reviewed', { targetType: 'project', targetId: project._id, projectId: project._id, metadata: { status: funding.status, visible: funding.isVisibleToBanks, visibilityMode: funding.visibilityMode } });
  res.json(funding);
});

router.patch('/admin/interests/:id', async (req, res) => {
  if (role(req) !== 'admin') return res.status(403).json({ error: 'Acceso solo para superadmin' });
  const hasStatus = req.body.status !== undefined;
  const markReviewed = req.body.markReviewed === true;
  if (!hasStatus && !markReviewed) return res.status(400).json({ error: 'No hay cambios que aplicar' });
  if (hasStatus && !INTEREST_STATUSES.includes(req.body.status)) return res.status(400).json({ error: 'Estado de interés inválido' });
  const interest = await FundingInterest.findOne({ _id: req.params.id, projectTenantKey: req.tenantKey });
  if (!interest) return res.status(404).json({ error: 'Interés no encontrado' });
  interest.reviewedBy = uid(req);
  if (hasStatus && req.body.status !== interest.status) {
    interest.status = req.body.status;
    if (req.body.status === 'contact_authorized') interest.contactAuthorizedAt = new Date();
    interest.history.push({ status: req.body.status, note: cleanText(req.body.note, 1000), changedBy: uid(req) });
  }
  if (markReviewed || (hasStatus && ['accepted', 'rejected', 'closed'].includes(req.body.status))) {
    interest.notificationPending = false;
    interest.notificationReviewedAt = new Date();
    interest.notificationReviewedBy = uid(req);
  }
  await interest.save(); res.json(interest);
});

router.get('/opportunities', async (req, res) => {
  if (!canViewMarketplace(req)) return res.status(403).json({ error: 'Acceso solo para bancos y superadmin' });
  const fundings = await ProjectFunding.find(opportunityFilter(req)).lean();
  const projects = await Project.find({ _id: { $in: fundings.map(f => f.project) }, publishStatus: 'approved', seeksFinancing: true }).lean();
  const byProject = new Map(projects.map(p => [String(p._id), p]));
  const projectIds = projects.map(p => p._id);
  const projectTenantKeys = [...new Set(projects.map(p => String(p.tenantKey || '')).filter(Boolean))];
  const [finances, units] = await Promise.all([
    ProjectFinance.find({ project: { $in: projectIds } }).lean(),
    Unit.find({
      projectId: { $in: projectIds },
      $and: [
        { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] },
        { $or: [{ tenantKey: { $in: projectTenantKeys } }, { tenantKey: { $exists: false } }, { tenantKey: null }] }
      ]
    }).select('projectId estado status precioLista').lean()
  ]);
  const financeByProject = new Map(finances.map(f => [String(f.project), f]));
  const unitsByProject = new Map(projectIds.map(id => [String(id), []]));
  units.forEach(unit => {
    unitsByProject.get(String(unit.projectId))?.push(unit);
  });
  res.json(fundings.map(f => {
    const project = byProject.get(String(f.project));
    if (!project) return null;
    const dto = publicDto(project, f, financeByProject.get(String(f.project)) || {});
    const sales = summarizeOpportunityUnits(unitsByProject.get(String(f.project)) || [], project);
    return { ...dto, ...sales };
  }).filter(Boolean));
});

router.get('/opportunities/:id', async (req, res) => {
  if (!canViewMarketplace(req)) return res.status(403).json({ error: 'Acceso solo para bancos y superadmin' });
  const funding = await ProjectFunding.findOne({ _id: req.params.id, ...opportunityFilter(req) }).lean();
  if (!funding) return res.status(404).json({ error: 'Oportunidad no encontrada' });
  const project = await Project.findOne({ _id: funding.project, publishStatus: 'approved', seeksFinancing: true }).lean();
  if (!project) return res.status(404).json({ error: 'Oportunidad no encontrada' });
  const [finance, opportunityUnits] = await Promise.all([
    ProjectFinance.findOne({ project: project._id, tenantKey: project.tenantKey }).lean(),
    Unit.find({ projectId: project._id, $and: [{ $or: [{ tenantKey: project.tenantKey }, { tenantKey: { $exists: false } }, { tenantKey: null }] }, { $or: [{ deletedAt: null }, { deletedAt: { $exists: false } }] }] }).select('modelo manzana lote m2 precioLista estado status').lean()
  ]);
  const dto = publicDto(project, funding, finance || {}, { detail: true });
  Object.assign(dto, summarizeOpportunityUnits(opportunityUnits, project));
  if ((funding.publicFields || []).some(field => ['units','prices'].includes(field))) {
    dto.units = opportunityUnits.map(unit => ({ model: unit.modelo || '', reference: [unit.manzana, unit.lote].filter(Boolean).join('-'), areaM2: unit.m2 || 0, price: (funding.publicFields || []).includes('prices') ? Number(unit.precioLista || 0) : undefined, status: unit.estado || unit.status || '' }));
  }
  if ((funding.publicFields || []).includes('documents') && funding.publicDocumentIds?.length) {
    const docs = await Document.find({ _id: { $in: funding.publicDocumentIds }, projectId: project._id, tenantKey: project.tenantKey }).select('originalname title mimetype size').lean();
    dto.documents = docs.map(doc => ({ _id: doc._id, name: doc.title || doc.originalname || 'Documento', mimetype: doc.mimetype, size: doc.size, downloadUrl: `/api/funding/opportunities/${funding._id}/documents/${doc._id}` }));
  }
  res.json(dto);
});

router.get('/opportunities/:id/documents/:documentId', async (req, res) => {
  if (!canViewMarketplace(req)) return res.status(403).json({ error: 'Acceso solo para bancos y superadmin' });
  const funding = await ProjectFunding.findOne({ _id: req.params.id, publicDocumentIds: req.params.documentId, ...opportunityFilter(req) }).lean();
  if (!funding || !(funding.publicFields || []).includes('documents')) return res.status(404).json({ error: 'Documento público no encontrado' });
  const doc = await Document.findOne({ _id: req.params.documentId, projectId: funding.project, tenantKey: funding.tenantKey }).lean();
  if (!doc) return res.status(404).json({ error: 'Documento público no encontrado' });
  const uploadRoot = path.resolve(__dirname, '..', 'uploads');
  const candidate = path.resolve(__dirname, '..', String(doc.path || ''));
  const relative = path.relative(uploadRoot, candidate);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(candidate)) return res.status(404).json({ error: 'Archivo no disponible' });
  res.setHeader('Cache-Control', 'private, no-store');
  await audit(req, 'funding.document.downloaded', { targetType: 'document', targetId: doc._id, projectId: funding.project, metadata: { opportunityId: funding._id, bankTenantKey: req.tenantKey } });
  res.download(candidate, doc.originalname || path.basename(candidate));
});

router.post('/opportunities/:id/interests', async (req, res) => {
  if (role(req) !== 'bank') return res.status(403).json({ error: 'Acceso solo para bancos' });
  const funding = await ProjectFunding.findOne({ _id: req.params.id, ...opportunityFilter(req) }).lean();
  if (!funding) return res.status(404).json({ error: 'Oportunidad no encontrada' });
  const amount = money(req.body.amount);
  const responsiblePerson = cleanText(req.body.responsiblePerson, 200);
  const internalContact = cleanText(req.body.internalContact, 300);
  if (!amount || !responsiblePerson || !internalContact) return res.status(400).json({ error: 'Importe, responsable y contacto son obligatorios' });
  const user = await User.findById(uid(req)).select('bankName').lean();
  const interest = await FundingInterest.create({ project: funding.project, funding: funding._id, projectTenantKey: funding.tenantKey, bankTenantKey: req.tenantKey, bankUser: uid(req), bankName: user?.bankName || req.tenantKey, amount, comment: cleanText(req.body.comment), responsiblePerson, internalContact, notificationPending: true, history: [{ status: 'received', changedBy: uid(req) }] });
  await audit(req, 'funding.interest.received', { targetType: 'project', targetId: funding.project, projectId: funding.project, metadata: { amount, bankTenantKey: req.tenantKey } });
  res.status(201).json({ ok: true, interestId: interest._id, status: interest.status });
});

module.exports = router;
