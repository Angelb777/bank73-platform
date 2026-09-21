'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Inspection = require('../models/Inspection');
const InspectionUnit = require('../models/InspectionUnit');
const InspectionEvidence = require('../models/InspectionEvidence');
const {
  findPreviousFinalizedInspection,
  buildInspectionReportContext,
  inspectionPackDto
} = require('../services/inspectionReportContext');

const IDS = {
  project: '64b000000000000000000010',
  current: '64b000000000000000000020',
  previous: '64b000000000000000000021'
};

const scope = {
  bankTenantKey: 'bank-a',
  projectTenantKey: 'project-owner',
  projectId: IDS.project
};

function baseSnapshot() {
  return {
    schemaVersion: 1,
    capturedAt: '2026-09-01T10:00:00.000Z',
    project: { id: IDS.project, name: 'Proyecto A', location: {}, type: 'Residencial', status: 'EN_CURSO' },
    participants: { bank: { tenantKey: 'bank-a', name: 'Banco A' }, promoter: null },
    finance: { summary: {}, financialConditions: {}, loanLines: [], plannedDisbursements: [], actualDisbursements: [] },
    planning: { phases: [], activeFronts: [] },
    compliance: { permits: [], requirements: [], documents: [], policies: [] },
    inventory: { models: [], folders: [], units: [] },
    history: {
      sequence: 3,
      previousInspectionId: IDS.previous,
      previousInspection: { id: IDS.previous, physicalProgressPercent: 42 },
      previousPhysicalProgressPercent: 42,
      previousCommonAreas: [],
      previousUnits: [{ unitId: 'unit-1', progressPercent: 40 }],
      previousPhotos: []
    },
    metrics: {
      administrativeProgress: { percent: 75, source: 'project_checklist' },
      physicalProgress: { previousPercent: 42, currentPercent: null, periodIncrementPercent: null, source: 'certified_inspections' },
      financialProgress: { percent: 30, source: 'project_finance' },
      scheduleProgress: { plannedPercent: null, variancePercent: null, source: 'project_program' }
    },
    pendingIssues: [],
    dataAvailability: { previousInspection: true }
  };
}

test('previous inspection lookup is scoped to bank, project tenant and finalized reports', async (t) => {
  const original = Inspection.findOne;
  let filter;
  let sort;
  t.after(() => { Inspection.findOne = original; });
  Inspection.findOne = value => {
    filter = value;
    return {
      sort(valueToSort) {
        sort = valueToSort;
        return { lean: async () => ({ _id: IDS.previous, projectProgressPercent: 42 }) };
      }
    };
  };

  const result = await findPreviousFinalizedInspection(scope, new Date('2026-09-20T00:00:00Z'), IDS.current);
  assert.equal(String(result._id), IDS.previous);
  assert.equal(filter.bankTenantKey, 'bank-a');
  assert.equal(filter.projectTenantKey, 'project-owner');
  assert.equal(filter.projectId, IDS.project);
  assert.equal(filter.status, 'finalized');
  assert.equal(filter.deletedAt, null);
  assert.deepEqual(filter._id, { $ne: IDS.current });
  assert.deepEqual(sort, { finalizedAt: -1, inspectionDate: -1, createdAt: -1 });
});

test('project without previous inspections returns no predecessor', async (t) => {
  const original = Inspection.findOne;
  t.after(() => { Inspection.findOne = original; });
  Inspection.findOne = () => ({ sort: () => ({ lean: async () => null }) });
  assert.equal(await findPreviousFinalizedInspection(scope, new Date()), null);
});

test('draft context calculates prior, period and accumulated physical progress independently', async (t) => {
  const originalUnits = InspectionUnit.find;
  const originalEvidence = InspectionEvidence.find;
  t.after(() => { InspectionUnit.find = originalUnits; InspectionEvidence.find = originalEvidence; });
  InspectionUnit.find = filter => {
    assert.equal(filter.bankTenantKey, 'bank-a');
    assert.equal(filter.projectTenantKey, 'project-owner');
    return { sort: () => ({ lean: async () => [
      { _id: 'unit-progress', unitId: 'unit-1', progressPercent: 58 },
      { _id: 'unit-progress-new', unitId: 'unit-2', progressPercent: 35, unitReferenceSnapshot: { code: 'NUEVA-2' } }
    ] }) };
  };
  InspectionEvidence.find = filter => {
    assert.equal(filter.projectId, IDS.project);
    return { sort: () => ({ lean: async () => [{ _id: 'photo-1', inspectionId: IDS.current, path: 'uploads/photo.jpg' }] }) };
  };

  const inspection = {
    _id: IDS.current,
    assignmentId: '64b000000000000000000030',
    avaluadorId: '64b000000000000000000031',
    status: 'draft',
    sequence: 3,
    projectProgressPercent: 57.5,
    commonAreas: [{ key: 'urbanizacion', name: 'Urbanización', progressPercent: 60 }],
    workFronts: [{ key: 'phase:new', name: 'Fase nueva', sourceType: 'phase', previousProgressKnown: false, previousProgressPercent: null, currentProgressPercent: 50 }],
    startSnapshot: baseSnapshot()
  };
  const context = await buildInspectionReportContext({ scope, inspection });
  assert.equal(context.metrics.physicalProgress.previousPercent, 42);
  assert.equal(context.metrics.physicalProgress.currentPercent, 57.5);
  assert.equal(context.metrics.physicalProgress.periodIncrementPercent, 15.5);
  assert.equal(context.metrics.administrativeProgress.percent, 75);
  assert.equal(context.metrics.financialProgress.percent, 30);
  assert.equal(context.inspectionUnits.length, 2);
  assert.equal(context.unitProgressComparisons[0].previousPercent, 40);
  assert.equal(context.unitProgressComparisons[0].periodIncrementPercent, 18);
  assert.equal(context.unitProgressComparisons[1].previousPercent, null);
  assert.equal(context.unitProgressComparisons[1].periodIncrementPercent, null);
  assert.equal(context.workFronts.find(item => item.key === 'phase:new').previousPercent, null);
  assert.equal(context.workFronts.find(item => item.key === 'common-area:urbanizacion').periodIncrementPercent, null);
  assert.equal(context.photos[0].filePath, `/api/mobile/v1/inspections/${IDS.current}/evidence/photo-1/file`);
});

test('finalized context returns the frozen report snapshot unchanged', async (t) => {
  const originalUnits = InspectionUnit.find;
  let queried = false;
  t.after(() => { InspectionUnit.find = originalUnits; });
  InspectionUnit.find = () => { queried = true; };
  const frozen = { schemaVersion: 1, project: { name: 'Nombre congelado' }, marker: 'signed' };
  const result = await buildInspectionReportContext({
    scope,
    inspection: { status: 'finalized', reportSnapshot: frozen }
  });
  assert.deepEqual(result, frozen);
  assert.equal(queried, false);
});

test('inspection pack exposes report-ready context without collapsing progress types', () => {
  const context = {
    ...baseSnapshot(),
    inspection: { id: IDS.current, status: 'draft' },
    inspectionUnits: [],
    photos: [],
    signature: null
  };
  const pack = inspectionPackDto(context);
  assert.equal(pack.sequence, 3);
  assert.equal(pack.previousInspection.id, IDS.previous);
  assert.equal(pack.metrics.physicalProgress.source, 'certified_inspections');
  assert.equal(pack.metrics.administrativeProgress.source, 'project_checklist');
  assert.equal(pack.metrics.financialProgress.source, 'project_finance');
  assert.ok(pack.reportSections.includes('photo_annex'));
  assert.ok(pack.reportSections.includes('economic_annex'));
});

test('legacy inspections remain valid without snapshot fields', async () => {
  const document = new Inspection({
    bankTenantKey: 'bank-a',
    projectTenantKey: 'project-owner',
    projectId: IDS.project,
    avaluadorId: '64b000000000000000000031',
    assignmentId: '64b000000000000000000030'
  });
  await document.validate();
  assert.equal(document.sequence, 1);
  assert.equal(document.previousInspectionId, null);
  assert.equal(document.startSnapshot, undefined);
  assert.equal(document.reportSnapshot, undefined);
});
