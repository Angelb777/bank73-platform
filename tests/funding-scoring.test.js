const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateFundingScore } = require('../services/fundingScoring');
const { financingMetrics, averageProjectSalePrice } = require('../services/fundingMetrics');
const bankReadOnly = require('../middleware/bankReadOnly');
const ProjectFunding = require('../models/ProjectFunding');
const FundingInterest = require('../models/FundingInterest');
const Project = require('../models/Project');
const ProjectFinance = require('../models/ProjectFinance');
const mongoose = require('mongoose');
const { opportunityFilterFor, applyPublicationAction } = require('../services/fundingPublication');
const { fundingProjectFilter } = require('../routes/funding');
const sift = require('sift').default;

function runBankGuard(method, originalUrl) {
  let nextCalled = false;
  let responseStatus = 200;
  let responseBody;
  const req = { method, originalUrl, user: { role: 'bank' } };
  const res = { status(value) { responseStatus = value; return this; }, json(value) { responseBody = value; return this; } };
  bankReadOnly(req, res, () => { nextCalled = true; });
  return { nextCalled, responseStatus, responseBody };
}

test('funding scoring stays between 0 and 100 and exposes a breakdown', () => {
  const result = calculateFundingScore({ project: {}, promoter: {}, permits: [], units: [], sales: [] });
  assert.ok(result.automaticScore >= 0 && result.automaticScore <= 100);
  assert.equal(result.scoreBreakdown.length, 10);
  assert.equal(result.scoreBreakdown.reduce((sum, item) => sum + item.maxScore, 0), 100);
});

test('complete project evidence scores higher than an empty project', () => {
  const empty = calculateFundingScore({ project: {}, promoter: {}, permits: [], units: [], sales: [] });
  const complete = calculateFundingScore({
    project: {
      location: 'Panamá', projectType: 'Mixto',
      financialConditions: { projectTotal: 1000000, promoterContribution: 300000, bankFinancedAmount: 500000 },
      financePhases: [{
        financialConditions: { phaseTotal: 1000000, bankFinancedAmount: 500000, promoterContribution: 300000 },
        financingLines: [{ approvedAmount: 300000 }]
      }],
      legalData: { assessment: { ...Object.fromEntries(['landOwned','purchaseOptionOrPromise','titleVerified','zoningApproved','licensesRequested','licensesApproved','legalOpinionAttached'].map(key => [key, true])), relevantEncumbrances: false } },
      technicalData: { assessment: Object.fromEntries(['conceptualProject','preliminaryDesign','approvedPlans','executiveProject','constructionBudget','contractorDefined','technicalOpinionAttached'].map(key => [key, true])) }
    },
    promoter: { promoterProfile: { yearsExperience: 15, deliveredProjects: 15, developedVolume: 50000000 } },
    permits: [{ items: [{ status: 'approved' }] }],
    units: [{ precioLista: 250000 }], sales: [{}]
  });
  assert.ok(complete.automaticScore > empty.automaticScore);
  assert.ok(complete.automaticScore >= 95);
});

test('legacy duplicated fundingRequest values are ignored', () => {
  const result = calculateFundingScore({
    project: { fundingRequest: { requestedAmount: 999999, alreadyFinancedAmount: 999999 } },
    promoter: {}, permits: [], units: [], sales: []
  });
  const requestFit = result.scoreBreakdown.find(item => item.key === 'request_fit');
  const funding = result.scoreBreakdown.find(item => item.key === 'funding');
  assert.equal(requestFit.automaticScore, 0);
  assert.equal(funding.automaticScore, 0);
});

test('phase sources and financing lines feed the financial score', () => {
  const result = calculateFundingScore({
    project: {}, promoter: {}, permits: [], units: [], sales: [],
    finance: {
      phases: [{
        financialConditions: { phaseTotal: 1000000, bankFinancedAmount: 500000, promoterContribution: 200000 },
        planSources: [{ name: 'Otras fuentes', amount: 100000 }],
        financingLines: [{ approvedAmount: 200000 }]
      }]
    }
  });
  assert.equal(result.scoreBreakdown.find(item => item.key === 'request_fit').automaticScore, 5);
  assert.ok(result.scoreBreakdown.find(item => item.key === 'funding').automaticScore > 0);
});

test('exact funding request feeds the existing request-fit criterion without changing its weight', () => {
  const result = calculateFundingScore({
    project: { financialConditions: { projectTotal: 1000000, bankFinancedAmount: 900000 } },
    promoter: {}, permits: [], units: [], sales: [], requestedAmount: 250000
  });
  const requestFit = result.scoreBreakdown.find(item => item.key === 'request_fit');
  assert.equal(requestFit.maxScore, 5);
  assert.equal(requestFit.automaticScore, 5);
  assert.match(requestFit.reason, /250000/);
});

test('marketplace metrics come from the existing financial structure', () => {
  const metrics = financingMetrics({}, { phases: [{
    name: 'Fase 1',
    financialConditions: { phaseTotal: 1000000, bankFinancedAmount: 500000, promoterContribution: 200000 },
    planSources: [{ name: 'Otras fuentes', amount: 100000 }],
    financingLines: [{ approvedAmount: 250000, term: '24 meses' }]
  }] });
  assert.equal(metrics.totalCost, 1000000);
  assert.equal(metrics.requestedAmount, 500000);
  assert.equal(metrics.alreadyFinanced, 550000);
  assert.equal(metrics.pendingAmount, 450000);
  assert.equal(metrics.financedPct, 55);
});

test('average sale price uses commercial units and falls back to housing models', () => {
  assert.equal(averageProjectSalePrice({}, [{ precioLista: 200000 }, { precioLista: 300000 }]), 250000);
  assert.equal(averageProjectSalePrice({ housingModels: [{ price: 100000, unitsCount: 1 }, { price: 200000, unitsCount: 3 }] }), 175000);
});

test('bank write guard allows only project creation and published-opportunity interest submission', () => {
  assert.equal(runBankGuard('POST', '/api/projects').nextCalled, true);
  assert.equal(runBankGuard('POST', '/api/funding/opportunities/abc123/interests').nextCalled, true);
  const blocked = runBankGuard('PATCH', '/api/projects/abc123');
  assert.equal(blocked.nextCalled, false);
  assert.equal(blocked.responseStatus, 403);
  assert.match(blocked.responseBody.error, /solo de lectura/i);
});

test('funding management always scopes projects to the active tenant', () => {
  const projectId = new mongoose.Types.ObjectId();
  assert.deepEqual(fundingProjectFilter({ tenantKey: 'bank-a' }), {
    tenantKey: 'bank-a',
    seeksFinancing: true
  });
  assert.deepEqual(fundingProjectFilter({ tenantKey: 'bank-a' }, projectId), {
    _id: projectId,
    tenantKey: 'bank-a',
    seeksFinancing: true
  });
});

test('request amounts and review notification are stored independently from financial and interest status', () => {
  assert.ok(ProjectFunding.schema.path('requestedAmount'));
  assert.ok(ProjectFunding.schema.path('securedRequestAmount'));
  assert.ok(FundingInterest.schema.path('status'));
  assert.ok(FundingInterest.schema.path('notificationPending'));
  assert.ok(FundingInterest.schema.path('notificationReviewedAt'));
});

test('publication configuration survives document reload with an explicit visibility mode', () => {
  const funding = new ProjectFunding({
    tenantKey: 'bancodemo', project: new mongoose.Types.ObjectId(),
    visibilityMode: 'selected_tenants', visibleToTenantKeys: ['bank-a', 'bank-b'],
    publicFields: ['description', 'financialSummary'], isVisibleToBanks: true,
    publicConclusions: 'Conclusión pública'
  });
  const reloaded = ProjectFunding.hydrate(funding.toObject());
  assert.equal(reloaded.visibilityMode, 'selected_tenants');
  assert.deepEqual(reloaded.visibleToTenantKeys, ['bank-a', 'bank-b']);
  assert.deepEqual(reloaded.publicFields, ['description', 'financialSummary']);
  assert.equal(reloaded.isVisibleToBanks, true);
});

test('publish and withdraw change only funding publication state and survive reload', () => {
  const userId = new mongoose.Types.ObjectId();
  const projectId = new mongoose.Types.ObjectId();
  const funding = new ProjectFunding({
    tenantKey: 'bancodemo', project: projectId, status: 'approved', finalScore: 78,
    fundingDeadline: new Date('2027-01-31T23:59:59.999Z'), visibilityMode: 'all_banks'
  });
  applyPublicationAction(funding, 'publish', { userId, now: new Date('2026-07-13T10:00:00.000Z') });
  let reloaded = ProjectFunding.hydrate(funding.toObject());
  assert.equal(reloaded.status, 'published');
  assert.equal(reloaded.isVisibleToBanks, true);
  assert.equal(String(reloaded.publishedBy), String(userId));
  applyPublicationAction(reloaded, 'withdraw', { userId });
  reloaded = ProjectFunding.hydrate(reloaded.toObject());
  assert.equal(reloaded.status, 'approved');
  assert.equal(reloaded.isVisibleToBanks, false);
  assert.equal(String(reloaded.project), String(projectId));
});

test('publication requires final scoring and a funding deadline', () => {
  const base = { tenantKey: 'bancodemo', project: new mongoose.Types.ObjectId(), status: 'approved' };
  assert.throws(() => applyPublicationAction(new ProjectFunding(base), 'publish'), /scoring final/i);
  assert.throws(() => applyPublicationAction(new ProjectFunding({ ...base, finalScore: 70 }), 'publish'), /fecha límite/i);
});

test('marketplace visibility filter distinguishes all banks, selected tenants and superadmin preview', () => {
  const bankFilter = opportunityFilterFor({ role: 'bank', tenantKey: 'bank-a' });
  assert.deepEqual(bankFilter.$and[0].$or[0].status.$in, ['published', 'partially_funded']);
  assert.ok(bankFilter.$and[1].$or.some(branch => branch.visibilityMode === 'all_banks'));
  assert.ok(bankFilter.$and[1].$or.some(branch => branch.visibilityMode === 'selected_tenants' && branch.visibleToTenantKeys === 'bank-a'));
  const adminFilter = opportunityFilterFor({ role: 'admin', tenantKey: 'bancodemo' });
  assert.equal(adminFilter.tenantKey, undefined);
  assert.deepEqual(adminFilter.$or[0].status.$in, ['published', 'partially_funded']);
});

test('marketplace query returns every published funding instead of only the first one', () => {
  const rows = [
    { name: 'Proyecto A', status: 'published', isVisibleToBanks: true, visibilityMode: 'all_banks', visibleToTenantKeys: [] },
    { name: 'Proyecto B', status: 'published', isVisibleToBanks: true, visibilityMode: 'all_banks', visibleToTenantKeys: [] },
    { name: 'Proyecto C', status: 'approved', isVisibleToBanks: true, visibilityMode: 'all_banks', visibleToTenantKeys: [] }
  ];
  const adminResults = rows.filter(sift(opportunityFilterFor({ role: 'admin', tenantKey: 'bancodemo' })));
  const bankResults = rows.filter(sift(opportunityFilterFor({ role: 'bank', tenantKey: 'bank-a' })));
  assert.deepEqual(adminResults.map(row => row.name), ['Proyecto A', 'Proyecto B']);
  assert.deepEqual(bankResults.map(row => row.name), ['Proyecto A', 'Proyecto B']);
});

test('multiple phase banks are schema data only and do not create tenant fields', () => {
  assert.ok(Project.schema.path('financePhases').schema.path('financierBanks'));
  assert.ok(ProjectFinance.schema.path('phases').schema.path('financierBanks'));
  const finance = new ProjectFinance({ tenantKey: 'bancodemo', project: new mongoose.Types.ObjectId(), phases: [{ name: 'Fase 1', financierBanks: ['Banco A', 'Banco B'] }] });
  assert.deepEqual(finance.phases[0].financierBanks, ['Banco A', 'Banco B']);
  assert.equal(finance.phases[0].financierTenantKeys, undefined);
});
