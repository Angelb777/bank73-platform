'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const mobileRouter = require('../routes/mobileAvaluator');
const Project = require('../models/Project');
const Unit = require('../models/Unit');
const ProjectAvaluatorAssignment = require('../models/ProjectAvaluatorAssignment');
const Inspection = require('../models/Inspection');
const InspectionUnit = require('../models/InspectionUnit');
const AvaluationTemplate = require('../models/AvaluationTemplate');
const ProjectBudgetLine = require('../models/ProjectBudgetLine');
const CommercialFolder = require('../models/CommercialFolder');

const IDS = {
  evaluatorA: '64b000000000000000000001',
  evaluatorB: '64b000000000000000000002',
  assignmentA: '64b000000000000000000003',
  projectA: '64b000000000000000000010',
  projectB: '64b000000000000000000011',
  inspectionA: '64b000000000000000000020',
  inspectionB: '64b000000000000000000021',
  unitA: '64b000000000000000000030',
  unitB: '64b000000000000000000031',
  inspectionUnitA: '64b000000000000000000040',
  folderA: '64b000000000000000000050',
  budgetLineA: '64b000000000000000000060'
};

function routeHandler(method, path) {
  return mobileRouter.stack.find(layer =>
    layer.route?.path === path && layer.route.methods[String(method).toLowerCase()]
  )?.route?.stack?.at(-1)?.handle;
}

function responseCapture() {
  const capture = { statusCode: 200, payload: null };
  capture.res = {
    status(code) { capture.statusCode = code; return this; },
    json(value) { capture.payload = value; return value; }
  };
  return capture;
}

function evaluatorReq(params = {}, body = {}) {
  return {
    tenantKey: 'bank-a',
    user: {
      userId: IDS.evaluatorA,
      role: 'avaluador',
      status: 'active',
      tenantKey: 'bank-a',
      tenantKeys: ['bank-a']
    },
    params,
    body
  };
}

function assignment(overrides = {}) {
  return {
    _id: IDS.assignmentA,
    bankTenantKey: 'bank-a',
    projectTenantKey: 'project-owner',
    projectId: IDS.projectA,
    avaluadorId: IDS.evaluatorA,
    status: 'active',
    ...overrides
  };
}

function inspection(overrides = {}) {
  return {
    _id: IDS.inspectionA,
    bankTenantKey: 'bank-a',
    projectTenantKey: 'project-owner',
    projectId: IDS.projectA,
    avaluadorId: IDS.evaluatorA,
    assignmentId: IDS.assignmentA,
    status: 'draft',
    inspectionDate: new Date('2026-09-01T10:00:00Z'),
    startedAt: new Date('2026-09-01T10:00:00Z'),
    generalObservations: '',
    version: 0,
    createdAt: new Date('2026-09-01T10:00:00Z'),
    updatedAt: new Date('2026-09-01T10:00:00Z'),
    ...overrides
  };
}

function inspectedUnit(overrides = {}) {
  return {
    _id: IDS.inspectionUnitA,
    bankTenantKey: 'bank-a',
    projectTenantKey: 'project-owner',
    inspectionId: IDS.inspectionA,
    projectId: IDS.projectA,
    unitId: IDS.unitA,
    unitReferenceSnapshot: { code: 'M-1', manzana: 'M', lote: '1', modelo: 'Casa' },
    progressPercent: 42.5,
    observations: 'Estructura avanzada',
    inspectedAt: new Date('2026-09-01T11:00:00Z'),
    updatedBy: IDS.evaluatorA,
    version: 0,
    createdAt: new Date('2026-09-01T11:00:00Z'),
    updatedAt: new Date('2026-09-01T11:00:00Z'),
    ...overrides
  };
}

function mockAssignedProject(t, assignmentValue = assignment(), options = {}) {
  const originalAssignmentFindOne = ProjectAvaluatorAssignment.findOne;
  const originalProjectFindOne = Project.findOne;
  const originalTemplateFindOne = AvaluationTemplate.findOne;
  const originalInspectionFindOne = Inspection.findOne;
  t.after(() => {
    ProjectAvaluatorAssignment.findOne = originalAssignmentFindOne;
    Project.findOne = originalProjectFindOne;
    AvaluationTemplate.findOne = originalTemplateFindOne;
    Inspection.findOne = originalInspectionFindOne;
  });
  ProjectAvaluatorAssignment.findOne = () => ({ lean: async () => assignmentValue });
  Project.findOne = () => ({ select: () => ({ lean: async () => assignmentValue ? ({ _id: IDS.projectA }) : null }) });
  AvaluationTemplate.findOne = () => ({ lean: async () => null });
  // Por defecto no hay inspeccion previa finalizada; los tests que necesiten
  // ejercitar la resolucion de previousInspectionId sobreescriben esto.
  Inspection.findOne = () => ({ sort: () => ({ select: () => ({ lean: async () => options.previousInspection ?? null }) }) });
}

function mockAuthorizedInspection(t, options = {}) {
  const inspectionValue = options.inspectionValue === undefined ? inspection() : options.inspectionValue;
  const assignmentValue = options.assignmentValue === undefined ? assignment() : options.assignmentValue;
  const originalInspectionFindOne = Inspection.findOne;
  const originalAssignmentFindOne = ProjectAvaluatorAssignment.findOne;
  const originalProjectFindOne = Project.findOne;
  t.after(() => {
    Inspection.findOne = originalInspectionFindOne;
    ProjectAvaluatorAssignment.findOne = originalAssignmentFindOne;
    Project.findOne = originalProjectFindOne;
  });
  Inspection.findOne = () => ({ lean: async () => inspectionValue });
  ProjectAvaluatorAssignment.findOne = () => ({ lean: async () => assignmentValue });
  Project.findOne = () => ({ select: () => ({ lean: async () => assignmentValue ? ({ _id: IDS.projectA }) : null }) });
}

test('inspection schemas keep history outside Unit and define required unique indexes', async () => {
  const inspectionDoc = new Inspection({
    bankTenantKey: 'bank-a', projectTenantKey: 'project-owner',
    projectId: IDS.projectA, avaluadorId: IDS.evaluatorA,
    assignmentId: IDS.assignmentA
  });
  await inspectionDoc.validate();
  assert.equal(inspectionDoc.status, 'draft');
  assert.equal(inspectionDoc.version, 0);

  const item = new InspectionUnit({
    bankTenantKey: 'bank-a', projectTenantKey: 'project-owner',
    inspectionId: IDS.inspectionA, projectId: IDS.projectA, unitId: IDS.unitA,
    unitReferenceSnapshot: { code: 'M-1', manzana: 'M', lote: '1', modelo: 'Casa' },
    progressPercent: 42.5, updatedBy: IDS.evaluatorA
  });
  await item.validate();
  assert.equal(item.progressPercent, 42.5);
  const uniqueIndex = InspectionUnit.schema.indexes().find(([fields, options]) =>
    options.unique && fields.inspectionId === 1 && fields.unitId === 1
  );
  assert.ok(uniqueIndex);
  assert.equal(Unit.schema.path('progressPercent'), undefined);
});

test('mobile API exposes the inspection lifecycle and evidence routes', () => {
  const actual = mobileRouter.stack
    .filter(layer => layer.route)
    .flatMap(layer => Object.keys(layer.route.methods).map(method => `${method.toUpperCase()} ${layer.route.path}`))
    .filter(route => route.includes('/inspections'))
    .sort();
  assert.deepEqual(actual, [
    'DELETE /inspections/:inspectionId',
    'DELETE /inspections/:inspectionId/evidence/:evidenceId',
    'GET /inspections/:inspectionId',
    'GET /inspections/:inspectionId/budget-lines',
    'GET /inspections/:inspectionId/evidence',
    'GET /inspections/:inspectionId/evidence/:evidenceId/file',
    'GET /inspections/:inspectionId/report.pdf',
    'GET /inspections/:inspectionId/units',
    'GET /inspections/:inspectionId/units/:unitId',
    'GET /projects/:projectId/inspections',
    'PATCH /inspections/:inspectionId',
    'POST /inspections/:inspectionId/evidence',
    'POST /inspections/:inspectionId/finalize',
    'POST /projects/:projectId/inspections',
    'PUT /inspections/:inspectionId/budget-lines/:budgetLineId',
    'PUT /inspections/:inspectionId/project-progress',
    'PUT /inspections/:inspectionId/units/:unitId'
  ].sort());
});

test('creates draft inspection only from active assignment and server identity', async (t) => {
  mockAssignedProject(t);
  const handler = routeHandler('post', '/projects/:projectId/inspections');
  const originalCreate = Inspection.create;
  let payload;
  t.after(() => { Inspection.create = originalCreate; });
  Inspection.create = async value => {
    payload = value;
    return inspection({ ...value, _id: IDS.inspectionA, createdAt: new Date(), updatedAt: new Date() });
  };

  const capture = responseCapture();
  await handler(evaluatorReq(
    { projectId: IDS.projectA },
    { inspectionDate: '2026-09-10', generalObservations: 'Visita inicial' }
  ), capture.res);

  assert.equal(capture.statusCode, 201);
  assert.equal(payload.bankTenantKey, 'bank-a');
  assert.equal(payload.projectTenantKey, 'project-owner');
  assert.equal(String(payload.projectId), IDS.projectA);
  assert.equal(String(payload.avaluadorId), IDS.evaluatorA);
  assert.equal(String(payload.assignmentId), IDS.assignmentA);
  assert.equal(payload.status, 'draft');
  assert.equal(payload.version, 0);
  assert.equal(payload.previousInspectionId, null);
});

test('previous inspection is resolved by bankTenantKey and projectId, not by project alone', async (t) => {
  const previous = inspection({ _id: IDS.inspectionB, status: 'finalized', finalizedAt: new Date('2026-08-01') });
  mockAssignedProject(t, assignment(), { previousInspection: previous });

  const originalFindOne = Inspection.findOne;
  let capturedFilter;
  t.after(() => { Inspection.findOne = originalFindOne; });
  Inspection.findOne = filter => {
    capturedFilter = filter;
    return { sort: () => ({ select: () => ({ lean: async () => previous }) }) };
  };

  const handler = routeHandler('post', '/projects/:projectId/inspections');
  const originalCreate = Inspection.create;
  let payload;
  t.after(() => { Inspection.create = originalCreate; });
  Inspection.create = async value => {
    payload = value;
    return inspection({ ...value, _id: IDS.inspectionA, createdAt: new Date(), updatedAt: new Date() });
  };

  const capture = responseCapture();
  await handler(evaluatorReq({ projectId: IDS.projectA }), capture.res);

  assert.equal(capture.statusCode, 201);
  assert.deepEqual(capturedFilter, {
    bankTenantKey: 'bank-a',
    projectId: IDS.projectA,
    status: 'finalized',
    deletedAt: null
  });
  assert.equal(String(payload.previousInspectionId), IDS.inspectionB);
});

test('unassigned or revoked project returns 404 and creates no inspection', async (t) => {
  mockAssignedProject(t, null);
  const originalCreate = Inspection.create;
  let createCalled = false;
  t.after(() => { Inspection.create = originalCreate; });
  Inspection.create = () => { createCalled = true; };

  const capture = responseCapture();
  await routeHandler('post', '/projects/:projectId/inspections')(
    evaluatorReq({ projectId: IDS.projectB }), capture.res
  );
  assert.equal(capture.statusCode, 404);
  assert.equal(createCalled, false);
});

test('protected inspection fields are rejected on create and edit', async () => {
  const createCapture = responseCapture();
  await routeHandler('post', '/projects/:projectId/inspections')(
    evaluatorReq({ projectId: IDS.projectA }, { status: 'submitted', bankTenantKey: 'bank-b' }),
    createCapture.res
  );
  assert.equal(createCapture.statusCode, 400);
  assert.deepEqual(createCapture.payload.fields.sort(), ['bankTenantKey', 'status']);

  const editCapture = responseCapture();
  await routeHandler('patch', '/inspections/:inspectionId')(
    evaluatorReq({ inspectionId: IDS.inspectionA }, { version: 0, projectId: IDS.projectB }),
    editCapture.res
  );
  assert.equal(editCapture.statusCode, 400);
  assert.deepEqual(editCapture.payload.fields, ['projectId']);

  const unitCapture = responseCapture();
  await routeHandler('put', '/inspections/:inspectionId/units/:unitId')(
    evaluatorReq(
      { inspectionId: IDS.inspectionA, unitId: IDS.unitA },
      { progressPercent: 20, projectTenantKey: 'other-tenant', updatedBy: IDS.evaluatorB }
    ),
    unitCapture.res
  );
  assert.equal(unitCapture.statusCode, 400);
  assert.deepEqual(unitCapture.payload.fields.sort(), ['projectTenantKey', 'updatedBy']);
});

test('other evaluator or bank tenant cannot read or edit an inspection by ID', async (t) => {
  const originalInspectionFindOne = Inspection.findOne;
  let filter;
  t.after(() => { Inspection.findOne = originalInspectionFindOne; });
  Inspection.findOne = value => {
    filter = value;
    return { lean: async () => null };
  };

  const readCapture = responseCapture();
  await routeHandler('get', '/inspections/:inspectionId')(
    evaluatorReq({ inspectionId: IDS.inspectionB }), readCapture.res
  );
  assert.equal(readCapture.statusCode, 404);
  assert.deepEqual(filter.bankTenantKey, { $in: ['bank-a'] });
  assert.equal(filter.avaluadorId, IDS.evaluatorA);

  const editCapture = responseCapture();
  await routeHandler('patch', '/inspections/:inspectionId')(
    evaluatorReq({ inspectionId: IDS.inspectionB }, { version: 0, generalObservations: 'Nope' }),
    editCapture.res
  );
  assert.equal(editCapture.statusCode, 404);
});

test('inter-tenant inspection lookup validates every assignment dimension', async (t) => {
  const originalInspectionFindOne = Inspection.findOne;
  const originalAssignmentFindOne = ProjectAvaluatorAssignment.findOne;
  const originalProjectFindOne = Project.findOne;
  let assignmentFilter;
  let projectFilter;
  t.after(() => {
    Inspection.findOne = originalInspectionFindOne;
    ProjectAvaluatorAssignment.findOne = originalAssignmentFindOne;
    Project.findOne = originalProjectFindOne;
  });
  Inspection.findOne = () => ({ lean: async () => inspection() });
  ProjectAvaluatorAssignment.findOne = filter => {
    assignmentFilter = filter;
    return { lean: async () => assignment() };
  };
  Project.findOne = filter => {
    projectFilter = filter;
    return { select: () => ({ lean: async () => ({ _id: IDS.projectA }) }) };
  };

  const capture = responseCapture();
  await routeHandler('get', '/inspections/:inspectionId')(
    evaluatorReq({ inspectionId: IDS.inspectionA }), capture.res
  );
  assert.equal(capture.statusCode, 200);
  assert.equal(assignmentFilter.bankTenantKey, 'bank-a');
  assert.equal(assignmentFilter.projectTenantKey, 'project-owner');
  assert.equal(assignmentFilter.avaluadorId, IDS.evaluatorA);
  assert.equal(assignmentFilter.status, 'active');
  assert.deepEqual(projectFilter, { _id: IDS.projectA, tenantKey: 'project-owner' });
});

test('draft edit increments version and stale version returns 409', async (t) => {
  mockAuthorizedInspection(t);
  const originalUpdate = Inspection.findOneAndUpdate;
  let updateFilter;
  t.after(() => { Inspection.findOneAndUpdate = originalUpdate; });
  Inspection.findOneAndUpdate = (filter, update) => {
    updateFilter = filter;
    assert.deepEqual(update.$inc, { version: 1 });
    return { lean: async () => inspection({ generalObservations: 'Actualizada', version: 1 }) };
  };

  const capture = responseCapture();
  await routeHandler('patch', '/inspections/:inspectionId')(
    evaluatorReq({ inspectionId: IDS.inspectionA }, { version: 0, generalObservations: 'Actualizada' }),
    capture.res
  );
  assert.equal(capture.statusCode, 200);
  assert.equal(updateFilter.version, 0);
  assert.equal(capture.payload.inspection.version, 1);

  Inspection.findOneAndUpdate = () => ({ lean: async () => null });
  const conflict = responseCapture();
  await routeHandler('patch', '/inspections/:inspectionId')(
    evaluatorReq({ inspectionId: IDS.inspectionA }, { version: 0, generalObservations: 'Obsoleta' }),
    conflict.res
  );
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.payload.error, 'version_conflict');
});

test('project progress is stored separately from unit progress', async (t) => {
  mockAuthorizedInspection(t);
  const originalUpdate = Inspection.findOneAndUpdate;
  let stored;
  t.after(() => { Inspection.findOneAndUpdate = originalUpdate; });
  Inspection.findOneAndUpdate = (filter, update) => {
    stored = update.$set;
    return { lean: async () => inspection({ ...stored, version: 1 }) };
  };
  const commonAreas = [
    { key: 'urbanizacion', progressPercent: 40, observations: 'Viales' },
    { key: 'infraestructura', progressPercent: 30, observations: 'Redes' },
    { key: 'zonas_comunes', progressPercent: 20, observations: '' },
    { key: 'exteriores', progressPercent: 10, observations: '' },
    { key: 'seguridad', progressPercent: 5, observations: '' }
  ];
  const capture = responseCapture();
  await routeHandler('put', '/inspections/:inspectionId/project-progress')(
    evaluatorReq(
      { inspectionId: IDS.inspectionA },
      { version: 0, projectProgressPercent: 32, commonAreas }
    ),
    capture.res
  );
  assert.equal(capture.statusCode, 200);
  assert.equal(stored.projectProgressPercent, 32);
  assert.equal(stored.commonAreas.length, 5);
  assert.equal(stored.commonAreas[0].name, 'Urbanización y viales');
  assert.equal(capture.payload.inspection.projectProgressPercent, 32);
});

test('finalizing stores signature and makes the inspection immutable', async (t) => {
  mockAuthorizedInspection(t, { inspectionValue: inspection({ projectProgressPercent: 35 }) });
  const originalCount = InspectionUnit.countDocuments;
  const originalUpdate = Inspection.findOneAndUpdate;
  let filter;
  let stored;
  t.after(() => {
    InspectionUnit.countDocuments = originalCount;
    Inspection.findOneAndUpdate = originalUpdate;
  });
  InspectionUnit.countDocuments = async () => 2;
  Inspection.findOneAndUpdate = (value, update) => {
    filter = value;
    stored = update.$set;
    return { lean: async () => inspection({ ...stored, version: 1 }) };
  };
  const capture = responseCapture();
  await routeHandler('post', '/inspections/:inspectionId/finalize')(
    evaluatorReq(
      { inspectionId: IDS.inspectionA },
      { version: 0, signerName: 'Perito Bank73', signatureImage: 'data:image/png;base64,aA==' }
    ),
    capture.res
  );
  assert.equal(capture.statusCode, 200);
  assert.equal(filter.status, 'draft');
  assert.equal(stored.status, 'finalized');
  assert.equal(stored.signature.signerName, 'Perito Bank73');
  assert.match(stored.reportNumber, /^B73-\d{4}-/);
  assert.equal(capture.payload.inspection.status, 'finalized');
});

test('valid unit progress creates a minimal immutable unit snapshot', async (t) => {
  mockAuthorizedInspection(t);
  const originalUnitFindOne = Unit.findOne;
  const originalItemFindOne = InspectionUnit.findOne;
  const originalCreate = InspectionUnit.create;
  let unitFilter;
  let created;
  t.after(() => {
    Unit.findOne = originalUnitFindOne;
    InspectionUnit.findOne = originalItemFindOne;
    InspectionUnit.create = originalCreate;
  });
  Unit.findOne = filter => {
    unitFilter = filter;
    return { select: () => ({ lean: async () => ({
      _id: IDS.unitA, code: 'M-1', manzana: 'M', lote: '1', modelo: 'Casa', clienteId: 'private'
    }) }) };
  };
  InspectionUnit.findOne = () => ({ lean: async () => null });
  InspectionUnit.create = async value => {
    created = value;
    return { _id: IDS.inspectionUnitA, ...value, createdAt: new Date(), updatedAt: new Date() };
  };

  const capture = responseCapture();
  await routeHandler('put', '/inspections/:inspectionId/units/:unitId')(
    evaluatorReq(
      { inspectionId: IDS.inspectionA, unitId: IDS.unitA },
      { progressPercent: 42.5, observations: 'Estructura avanzada' }
    ), capture.res
  );
  assert.equal(capture.statusCode, 201);
  assert.deepEqual(unitFilter, {
    _id: IDS.unitA, tenantKey: 'project-owner', projectId: IDS.projectA, deletedAt: null
  });
  assert.deepEqual(created.unitReferenceSnapshot, {
    code: 'M-1', manzana: 'M', lote: '1', modelo: 'Casa'
  });
  assert.equal('clienteId' in created.unitReferenceSnapshot, false);
  assert.equal(created.progressPercent, 42.5);
  assert.equal(created.version, 0);
});

test('unit from another project returns 404', async (t) => {
  mockAuthorizedInspection(t);
  const originalUnitFindOne = Unit.findOne;
  const originalCreate = InspectionUnit.create;
  let createCalled = false;
  t.after(() => {
    Unit.findOne = originalUnitFindOne;
    InspectionUnit.create = originalCreate;
  });
  Unit.findOne = () => ({ select: () => ({ lean: async () => null }) });
  InspectionUnit.create = () => { createCalled = true; };

  const capture = responseCapture();
  await routeHandler('put', '/inspections/:inspectionId/units/:unitId')(
    evaluatorReq(
      { inspectionId: IDS.inspectionA, unitId: IDS.unitB },
      { progressPercent: 50 }
    ), capture.res
  );
  assert.equal(capture.statusCode, 404);
  assert.equal(createCalled, false);
});

test('legacy progress percent outside 0..100 is rejected', async (t) => {
  mockAuthorizedInspection(t);
  const originalUnitFindOne = Unit.findOne;
  const originalItemFindOne = InspectionUnit.findOne;
  const originalCreate = InspectionUnit.create;
  let createCalled = false;
  t.after(() => {
    Unit.findOne = originalUnitFindOne;
    InspectionUnit.findOne = originalItemFindOne;
    InspectionUnit.create = originalCreate;
  });
  Unit.findOne = () => ({ select: () => ({ lean: async () => ({ _id: IDS.unitA }) }) });
  InspectionUnit.findOne = () => ({ lean: async () => null });
  InspectionUnit.create = () => { createCalled = true; };

  for (const progressPercent of [-0.1, 100.1, null]) {
    const capture = responseCapture();
    await routeHandler('put', '/inspections/:inspectionId/units/:unitId')(
      evaluatorReq(
        { inspectionId: IDS.inspectionA, unitId: IDS.unitA },
        { progressPercent }
      ), capture.res
    );
    assert.equal(capture.statusCode, 400);
  }
  assert.equal(createCalled, false);
});

test('updating the same inspection unit uses the unique identity and increments version', async (t) => {
  mockAuthorizedInspection(t);
  const originalUnitFindOne = Unit.findOne;
  const originalItemFindOne = InspectionUnit.findOne;
  const originalItemUpdate = InspectionUnit.findOneAndUpdate;
  const originalCreate = InspectionUnit.create;
  let updateFilter;
  let createCalled = false;
  t.after(() => {
    Unit.findOne = originalUnitFindOne;
    InspectionUnit.findOne = originalItemFindOne;
    InspectionUnit.findOneAndUpdate = originalItemUpdate;
    InspectionUnit.create = originalCreate;
  });
  Unit.findOne = () => ({ select: () => ({ lean: async () => ({ _id: IDS.unitA }) }) });
  InspectionUnit.findOne = () => ({ lean: async () => ({ _id: IDS.inspectionUnitA, version: 0 }) });
  InspectionUnit.findOneAndUpdate = (filter, update) => {
    updateFilter = filter;
    assert.deepEqual(update.$inc, { version: 1 });
    return { lean: async () => ({
      _id: IDS.inspectionUnitA,
      ...filter,
      unitReferenceSnapshot: {},
      progressPercent: 55,
      observations: 'Actualizada',
      inspectedAt: new Date(),
      version: 1,
      createdAt: new Date(),
      updatedAt: new Date()
    }) };
  };
  InspectionUnit.create = () => { createCalled = true; };

  const capture = responseCapture();
  await routeHandler('put', '/inspections/:inspectionId/units/:unitId')(
    evaluatorReq(
      { inspectionId: IDS.inspectionA, unitId: IDS.unitA },
      { progressPercent: 55, observations: 'Actualizada', version: 0 }
    ), capture.res
  );
  assert.equal(capture.statusCode, 200);
  assert.equal(updateFilter.inspectionId, IDS.inspectionA);
  assert.equal(updateFilter.unitId, IDS.unitA);
  assert.equal(updateFilter.version, 0);
  assert.equal(createCalled, false);
  assert.equal(capture.payload.inspectionUnit.version, 1);
});

test('inspected-unit reads use every inspection scope and return only the mobile DTO', async (t) => {
  mockAuthorizedInspection(t);
  const originalFind = InspectionUnit.find;
  let filter;
  t.after(() => { InspectionUnit.find = originalFind; });
  InspectionUnit.find = value => {
    filter = value;
    return { sort: () => ({ lean: async () => [inspectedUnit({ privateValue: 'hidden' })] }) };
  };

  const capture = responseCapture();
  await routeHandler('get', '/inspections/:inspectionId/units')(
    evaluatorReq({ inspectionId: IDS.inspectionA }), capture.res
  );

  assert.equal(capture.statusCode, 200);
  assert.deepEqual(filter, {
    bankTenantKey: 'bank-a',
    projectTenantKey: 'project-owner',
    inspectionId: IDS.inspectionA,
    projectId: IDS.projectA
  });
  assert.equal(capture.payload.units.length, 1);
  assert.equal(capture.payload.units[0].progressPercent, 42.5);
  assert.equal('privateValue' in capture.payload.units[0], false);
  assert.equal('bankTenantKey' in capture.payload.units[0], false);
  assert.equal('updatedBy' in capture.payload.units[0], false);
});

test('revoked assignment blocks further draft edits and progress writes', async (t) => {
  mockAuthorizedInspection(t, { assignmentValue: null });
  const originalInspectionUpdate = Inspection.findOneAndUpdate;
  const originalUnitFindOne = Unit.findOne;
  let inspectionUpdated = false;
  let unitQueried = false;
  t.after(() => {
    Inspection.findOneAndUpdate = originalInspectionUpdate;
    Unit.findOne = originalUnitFindOne;
  });
  Inspection.findOneAndUpdate = () => { inspectionUpdated = true; };
  Unit.findOne = () => { unitQueried = true; };

  const edit = responseCapture();
  await routeHandler('patch', '/inspections/:inspectionId')(
    evaluatorReq({ inspectionId: IDS.inspectionA }, { version: 0, generalObservations: 'Nope' }),
    edit.res
  );
  assert.equal(edit.statusCode, 404);
  assert.equal(inspectionUpdated, false);

  const progress = responseCapture();
  await routeHandler('put', '/inspections/:inspectionId/units/:unitId')(
    evaluatorReq(
      { inspectionId: IDS.inspectionA, unitId: IDS.unitA },
      { progressPercent: 20 }
    ), progress.res
  );
  assert.equal(progress.statusCode, 404);
  assert.equal(unitQueried, false);
});


test('draft deletion is conditional on version and cannot delete finalized reports', async (t) => {
  mockAuthorizedInspection(t);
  const original = Inspection.findOneAndUpdate;
  t.after(() => { Inspection.findOneAndUpdate = original; });
  let filter;
  Inspection.findOneAndUpdate = query => { filter = query; return { lean: async () => ({ deletedAt: new Date() }) }; };
  const handler = routeHandler('delete', '/inspections/:inspectionId');
  const req = evaluatorReq({ inspectionId: IDS.inspectionA });
  req.query = { version: '0' };
  const capture = responseCapture();
  await handler(req, capture.res);
  assert.equal(capture.statusCode, 200);
  assert.equal(filter.status, 'draft');
  assert.equal(filter.deletedAt, null);
  assert.equal(filter.version, 0);
  Inspection.findOneAndUpdate = () => ({ lean: async () => null });
  const stale = responseCapture();
  await handler(req, stale.res);
  assert.equal(stale.statusCode, 409);
  Inspection.findOne = () => ({ lean: async () => inspection({ status: 'finalized' }) });
  const finalized = responseCapture();
  await handler(req, finalized.res);
  assert.equal(finalized.statusCode, 409);
});

test('promoter progress matches checklist progress including empty subtasks', () => {
  const { promoterProgress } = mobileRouter._helpers;
  assert.equal(promoterProgress([]), 0);
  assert.equal(promoterProgress([
    { subtasks: [{ completed: true }, { completed: false }, { completed: false }] },
    { status: 'EN_PROCESO' }, { status: 'COMPLETADO' }, { status: 'PENDIENTE' }
  ]), 46);
});


test('finalization validates and stores technical recommendation with signed inspection', async (t) => {
  mockAuthorizedInspection(t, { inspectionValue: inspection({ projectProgressPercent: 35 }) });
  const originalCount = InspectionUnit.countDocuments;
  const originalUpdate = Inspection.findOneAndUpdate;
  t.after(() => { InspectionUnit.countDocuments = originalCount; Inspection.findOneAndUpdate = originalUpdate; });
  InspectionUnit.countDocuments = async () => 1;
  let stored;
  Inspection.findOneAndUpdate = (filter, update) => {
    stored = update.$set;
    return { lean: async () => inspection({ ...stored, version: 1 }) };
  };
  const handler = routeHandler('post', '/inspections/:inspectionId/finalize');
  const body = { version: 0, signerName: 'Avaluador', signatureImage: 'data:image/png;base64,aA==' };
  for (const verdict of ['favorable', 'conditional', 'unfavorable', 'not_assessed']) {
    const capture = responseCapture();
    await handler(evaluatorReq({ inspectionId: IDS.inspectionA }, { ...body, technicalRecommendation: { verdict, notes: ' Justificacion y condiciones ' } }), capture.res);
    assert.equal(capture.statusCode, 200);
    assert.deepEqual(stored.technicalRecommendation, { verdict, notes: 'Justificacion y condiciones' });
    assert.deepEqual(capture.payload.inspection.technicalRecommendation, stored.technicalRecommendation);
  }
  for (const technicalRecommendation of [
    { verdict: 'approved', notes: 'No permitido' },
    { verdict: 'conditional', notes: ' ' },
    { verdict: 'favorable', notes: '' },
    { verdict: 'unfavorable', notes: '' },
    { verdict: 'favorable', notes: 'x'.repeat(5001) },
    { verdict: 'favorable', notes: 'Justificado', bankApproval: true }, null
  ]) {
    const capture = responseCapture();
    await handler(evaluatorReq({ inspectionId: IDS.inspectionA }, { ...body, technicalRecommendation }), capture.res);
    assert.equal(capture.statusCode, 400);
  }
});

function budgetLine(overrides = {}) {
  return {
    _id: IDS.budgetLineA,
    commercialFolderId: IDS.folderA,
    code: '11.1',
    name: 'Estructura',
    category: 'infraestructura',
    order: 0,
    isActive: true,
    ...overrides
  };
}

function folder(overrides = {}) {
  return { _id: IDS.folderA, name: 'Torre 1', color: '#111111', order: 0, ...overrides };
}

test('budget-lines view merges the catalog with current and previous inspection progress', async (t) => {
  mockAuthorizedInspection(t);
  const originalFolderFind = CommercialFolder.find;
  const originalLineFind = ProjectBudgetLine.find;
  t.after(() => {
    CommercialFolder.find = originalFolderFind;
    ProjectBudgetLine.find = originalLineFind;
  });
  CommercialFolder.find = () => ({ sort: () => ({ lean: async () => [folder()] }) });
  ProjectBudgetLine.find = () => ({ sort: () => ({ lean: async () => [budgetLine()] }) });

  const capture = responseCapture();
  await routeHandler('get', '/inspections/:inspectionId/budget-lines')(
    evaluatorReq({ inspectionId: IDS.inspectionA }), capture.res
  );

  assert.equal(capture.statusCode, 200);
  assert.equal(capture.payload.folders.length, 1);
  assert.equal(capture.payload.folders[0].id, IDS.folderA);
  assert.equal(capture.payload.folders[0].lines.length, 1);
  assert.equal(capture.payload.folders[0].lines[0].id, IDS.budgetLineA);
  assert.equal(capture.payload.folders[0].lines[0].current, null);
  assert.equal(capture.payload.folders[0].lines[0].previous, null);
});

test('empty towers (no active budget lines) are left out of the budget-lines view', async (t) => {
  mockAuthorizedInspection(t);
  const originalFolderFind = CommercialFolder.find;
  const originalLineFind = ProjectBudgetLine.find;
  t.after(() => {
    CommercialFolder.find = originalFolderFind;
    ProjectBudgetLine.find = originalLineFind;
  });
  CommercialFolder.find = () => ({ sort: () => ({ lean: async () => [folder()] }) });
  ProjectBudgetLine.find = () => ({ sort: () => ({ lean: async () => [] }) });

  const capture = responseCapture();
  await routeHandler('get', '/inspections/:inspectionId/budget-lines')(
    evaluatorReq({ inspectionId: IDS.inspectionA }), capture.res
  );
  assert.equal(capture.statusCode, 200);
  assert.deepEqual(capture.payload.folders, []);
});

test('registering physical progress for a new budget line pushes it into the inspection', async (t) => {
  mockAuthorizedInspection(t);
  const originalLineFindOne = ProjectBudgetLine.findOne;
  const originalFolderFindOne = CommercialFolder.findOne;
  const originalUpdate = Inspection.findOneAndUpdate;
  t.after(() => {
    ProjectBudgetLine.findOne = originalLineFindOne;
    CommercialFolder.findOne = originalFolderFindOne;
    Inspection.findOneAndUpdate = originalUpdate;
  });
  ProjectBudgetLine.findOne = () => ({ lean: async () => budgetLine() });
  CommercialFolder.findOne = () => ({ select: () => ({ lean: async () => folder() }) });
  let capturedFilter;
  let capturedUpdate;
  Inspection.findOneAndUpdate = (filter, update) => {
    capturedFilter = filter;
    capturedUpdate = update;
    return {
      lean: async () => inspection({
        budgetLineProgress: [{
          budgetLineId: IDS.budgetLineA,
          commercialFolderId: IDS.folderA,
          lineSnapshot: { code: '11.1', name: 'Estructura', category: 'infraestructura', commercialFolderName: 'Torre 1' },
          physicalProgressPercent: 25,
          observations: 'Armado de columnas',
          updatedAt: new Date()
        }],
        version: 1
      })
    };
  };

  const capture = responseCapture();
  await routeHandler('put', '/inspections/:inspectionId/budget-lines/:budgetLineId')(
    evaluatorReq(
      { inspectionId: IDS.inspectionA, budgetLineId: IDS.budgetLineA },
      { physicalProgressPercent: 25, observations: 'Armado de columnas', version: 0 }
    ), capture.res
  );

  assert.equal(capture.statusCode, 200);
  assert.ok(capturedUpdate.$push);
  assert.equal(capturedUpdate.$push.budgetLineProgress.physicalProgressPercent, 25);
  assert.equal(capturedFilter.version, 0);
  assert.equal(capture.payload.inspection.budgetLineProgress[0].physicalProgressPercent, 25);
});

test('registering physical progress for an existing budget line updates it in place', async (t) => {
  mockAuthorizedInspection(t, {
    inspectionValue: inspection({
      budgetLineProgress: [{
        budgetLineId: IDS.budgetLineA,
        commercialFolderId: IDS.folderA,
        lineSnapshot: { code: '11.1', name: 'Estructura', category: 'infraestructura', commercialFolderName: 'Torre 1' },
        physicalProgressPercent: 10,
        observations: '',
        updatedAt: new Date()
      }]
    })
  });
  const originalLineFindOne = ProjectBudgetLine.findOne;
  const originalFolderFindOne = CommercialFolder.findOne;
  const originalUpdate = Inspection.findOneAndUpdate;
  t.after(() => {
    ProjectBudgetLine.findOne = originalLineFindOne;
    CommercialFolder.findOne = originalFolderFindOne;
    Inspection.findOneAndUpdate = originalUpdate;
  });
  ProjectBudgetLine.findOne = () => ({ lean: async () => budgetLine() });
  CommercialFolder.findOne = () => ({ select: () => ({ lean: async () => folder() }) });
  let capturedFilter;
  let capturedUpdate;
  Inspection.findOneAndUpdate = (filter, update) => {
    capturedFilter = filter;
    capturedUpdate = update;
    return { lean: async () => inspection({ version: 1 }) };
  };

  const capture = responseCapture();
  await routeHandler('put', '/inspections/:inspectionId/budget-lines/:budgetLineId')(
    evaluatorReq(
      { inspectionId: IDS.inspectionA, budgetLineId: IDS.budgetLineA },
      { physicalProgressPercent: 55, observations: 'Losa vaciada', version: 0 }
    ), capture.res
  );

  assert.equal(capture.statusCode, 200);
  assert.equal(capturedFilter['budgetLineProgress.budgetLineId'], IDS.budgetLineA);
  assert.equal(capturedUpdate.$set['budgetLineProgress.$.physicalProgressPercent'], 55);
  assert.equal(capturedUpdate.$set['budgetLineProgress.$.observations'], 'Losa vaciada');
});

test('economicAmountPeriod sent by the client is rejected as an unexpected field', async () => {
  const capture = responseCapture();
  await routeHandler('put', '/inspections/:inspectionId/budget-lines/:budgetLineId')(
    evaluatorReq(
      { inspectionId: IDS.inspectionA, budgetLineId: IDS.budgetLineA },
      { physicalProgressPercent: 25, economicAmountPeriod: 5000, version: 0 }
    ), capture.res
  );
  assert.equal(capture.statusCode, 400);
  assert.deepEqual(capture.payload.fields, ['economicAmountPeriod']);
});

test('finalize computes previous/period/accumulated per budget line and freezes it', async (t) => {
  mockAuthorizedInspection(t, {
    inspectionValue: inspection({
      projectProgressPercent: 35,
      previousInspectionId: IDS.inspectionB,
      budgetLineProgress: [{
        budgetLineId: IDS.budgetLineA,
        commercialFolderId: IDS.folderA,
        lineSnapshot: { code: '11.1', name: 'Estructura', category: 'infraestructura', commercialFolderName: 'Torre 1' },
        physicalProgressPercent: 60,
        observations: '',
        economicAmountPeriod: null,
        economicAmountReported: false
      }]
    })
  });
  const originalCount = InspectionUnit.countDocuments;
  const originalFindById = Inspection.findById;
  const originalUpdate = Inspection.findOneAndUpdate;
  t.after(() => {
    InspectionUnit.countDocuments = originalCount;
    Inspection.findById = originalFindById;
    Inspection.findOneAndUpdate = originalUpdate;
  });
  InspectionUnit.countDocuments = async () => 0;
  Inspection.findById = () => ({
    select: () => ({
      lean: async () => ({
        _id: IDS.inspectionB,
        inspectionDate: new Date('2026-08-01'),
        budgetLineProgress: [{ budgetLineId: IDS.budgetLineA, physicalProgressPercent: 40 }]
      })
    })
  });
  let stored;
  Inspection.findOneAndUpdate = (filter, update) => {
    stored = update.$set;
    return { lean: async () => inspection({ ...stored, version: 1 }) };
  };

  const capture = responseCapture();
  await routeHandler('post', '/inspections/:inspectionId/finalize')(
    evaluatorReq(
      { inspectionId: IDS.inspectionA },
      { version: 0, signerName: 'Avaluador', signatureImage: 'data:image/png;base64,aA==' }
    ), capture.res
  );

  assert.equal(capture.statusCode, 200);
  assert.equal(String(stored.financialSummarySnapshot.previousInspectionId), IDS.inspectionB);
  const line = stored.financialSummarySnapshot.budgetLines[0];
  assert.equal(line.physicalProgressPercent.previous, 40);
  assert.equal(line.physicalProgressPercent.period, 20);
  assert.equal(line.physicalProgressPercent.accumulated, 60);
});

test('finalize without budget-line progress does not add a financial summary snapshot', async (t) => {
  mockAuthorizedInspection(t, { inspectionValue: inspection({ projectProgressPercent: 35 }) });
  const originalCount = InspectionUnit.countDocuments;
  const originalUpdate = Inspection.findOneAndUpdate;
  t.after(() => {
    InspectionUnit.countDocuments = originalCount;
    Inspection.findOneAndUpdate = originalUpdate;
  });
  InspectionUnit.countDocuments = async () => 0;
  let stored;
  Inspection.findOneAndUpdate = (filter, update) => {
    stored = update.$set;
    return { lean: async () => inspection({ ...stored, version: 1 }) };
  };

  const capture = responseCapture();
  await routeHandler('post', '/inspections/:inspectionId/finalize')(
    evaluatorReq(
      { inspectionId: IDS.inspectionA },
      { version: 0, signerName: 'Avaluador', signatureImage: 'data:image/png;base64,aA==' }
    ), capture.res
  );
  assert.equal(capture.statusCode, 200);
  assert.equal('financialSummarySnapshot' in stored, false);
});
