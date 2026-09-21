'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const bankRouter = require('../routes/bank');
const mobileRouter = require('../routes/mobileAvaluator');
const AvaluationTemplate = require('../models/AvaluationTemplate');
const ProjectAvaluatorAssignment = require('../models/ProjectAvaluatorAssignment');
const Project = require('../models/Project');
const Unit = require('../models/Unit');
const Inspection = require('../models/Inspection');
const InspectionUnit = require('../models/InspectionUnit');
const AuditLog = require('../models/AuditLog');

const IDS = {
  bankUser: '64c000000000000000000001',
  evaluator: '64c000000000000000000002',
  assignment: '64c000000000000000000003',
  project: '64c000000000000000000004',
  template: '64c000000000000000000005',
  otherTemplate: '64c000000000000000000006',
  inspection: '64c000000000000000000007',
  unit: '64c000000000000000000008',
  inspectionUnit: '64c000000000000000000009'
};

const SECTIONS = [
  { key: 'estructura', name: 'Estructura', weight: 40, order: 1 },
  { key: 'acabados', name: 'Acabados', weight: 60, order: 2 }
];

function routeHandler(router, method, path) {
  return router.stack.find(layer =>
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

function bankReq(params = {}, body = {}, tenantKey = 'bank-a') {
  return {
    tenantKey,
    user: {
      userId: IDS.bankUser,
      role: 'bank',
      tenantKey,
      tenantKeys: [tenantKey]
    },
    params,
    body,
    headers: {}
  };
}

function evaluatorReq(params = {}, body = {}) {
  return {
    tenantKey: 'bank-a',
    user: {
      userId: IDS.evaluator,
      role: 'avaluador',
      status: 'active',
      tenantKey: 'bank-a',
      tenantKeys: ['bank-a']
    },
    params,
    body
  };
}

function template(overrides = {}) {
  return {
    _id: IDS.template,
    bankTenantKey: 'bank-a',
    name: 'Metodo banco A',
    version: 3,
    status: 'active',
    sections: SECTIONS.map(section => ({ ...section })),
    createdBy: IDS.bankUser,
    createdAt: new Date('2026-09-10T10:00:00Z'),
    updatedAt: new Date('2026-09-10T10:00:00Z'),
    ...overrides
  };
}

function assignment() {
  return {
    _id: IDS.assignment,
    bankTenantKey: 'bank-a',
    projectTenantKey: 'project-owner-b',
    projectId: IDS.project,
    avaluadorId: IDS.evaluator,
    status: 'active'
  };
}

function structuredInspection(overrides = {}) {
  return {
    _id: IDS.inspection,
    bankTenantKey: 'bank-a',
    projectTenantKey: 'project-owner-b',
    projectId: IDS.project,
    avaluadorId: IDS.evaluator,
    assignmentId: IDS.assignment,
    status: 'draft',
    inspectionDate: new Date(),
    startedAt: new Date(),
    methodology: mobileRouter._helpers.methodologySnapshot(template()),
    generalObservations: '',
    version: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

function mockAudit(t) {
  const original = AuditLog.create;
  t.after(() => { AuditLog.create = original; });
  AuditLog.create = async () => ({});
}

function mockStructuredAuthorization(t) {
  const originals = {
    inspectionFindOne: Inspection.findOne,
    assignmentFindOne: ProjectAvaluatorAssignment.findOne,
    projectFindOne: Project.findOne
  };
  t.after(() => {
    Inspection.findOne = originals.inspectionFindOne;
    ProjectAvaluatorAssignment.findOne = originals.assignmentFindOne;
    Project.findOne = originals.projectFindOne;
  });
  Inspection.findOne = () => ({ lean: async () => structuredInspection() });
  ProjectAvaluatorAssignment.findOne = () => ({ lean: async () => assignment() });
  Project.findOne = () => ({ select: () => ({ lean: async () => ({ _id: IDS.project }) }) });
}

test('template schema enforces tenant versioning, unique keys and weights totaling 100', async () => {
  const valid = new AvaluationTemplate({
    bankTenantKey: 'bank-a', name: 'Metodo', version: 1,
    sections: SECTIONS, createdBy: IDS.bankUser
  });
  await valid.validate();
  assert.equal(valid.status, 'draft');

  const wrongWeight = new AvaluationTemplate({
    bankTenantKey: 'bank-a', name: 'Metodo', version: 2,
    sections: [{ ...SECTIONS[0], weight: 30 }, SECTIONS[1]], createdBy: IDS.bankUser
  });
  await assert.rejects(wrongWeight.validate());

  const duplicateKey = new AvaluationTemplate({
    bankTenantKey: 'bank-a', name: 'Metodo', version: 2,
    sections: [SECTIONS[0], { ...SECTIONS[1], key: 'estructura' }], createdBy: IDS.bankUser
  });
  await assert.rejects(duplicateKey.validate());

  const indexes = AvaluationTemplate.schema.indexes();
  assert.ok(indexes.some(([fields, options]) =>
    options.unique && fields.bankTenantKey === 1 && fields.version === 1
  ));
  assert.ok(indexes.some(([fields, options]) =>
    options.unique && fields.bankTenantKey === 1 && fields.status === 1 &&
    options.partialFilterExpression?.status === 'active'
  ));
});

test('bank creates a draft template version only in its authenticated tenant', async (t) => {
  mockAudit(t);
  const originalFindOne = AvaluationTemplate.findOne;
  const originalCreate = AvaluationTemplate.create;
  let created;
  t.after(() => {
    AvaluationTemplate.findOne = originalFindOne;
    AvaluationTemplate.create = originalCreate;
  });
  AvaluationTemplate.findOne = () => ({
    sort: () => ({ select: () => ({ lean: async () => ({ version: 2 }) }) })
  });
  AvaluationTemplate.create = async value => {
    created = value;
    return template({ ...value, _id: IDS.template, createdAt: new Date(), updatedAt: new Date() });
  };

  const capture = responseCapture();
  await routeHandler(bankRouter, 'post', '/avaluation-templates')(
    bankReq({}, { name: 'Metodo banco A', sections: SECTIONS, bankTenantKey: 'bank-b' }),
    capture.res
  );
  assert.equal(capture.statusCode, 400);

  const success = responseCapture();
  await routeHandler(bankRouter, 'post', '/avaluation-templates')(
    bankReq({}, { name: 'Metodo banco A', sections: SECTIONS }), success.res
  );
  assert.equal(success.statusCode, 201);
  assert.equal(created.bankTenantKey, 'bank-a');
  assert.equal(created.version, 3);
  assert.equal(created.status, 'draft');
  assert.equal(created.createdBy, IDS.bankUser);
  assert.equal('bankTenantKey' in success.payload.template, false);
});

test('bank cannot read or activate a template from another bank tenant', async (t) => {
  const originalFindOne = AvaluationTemplate.findOne;
  let filters = [];
  t.after(() => { AvaluationTemplate.findOne = originalFindOne; });
  AvaluationTemplate.findOne = filter => {
    filters.push(filter);
    return { lean: async () => null };
  };

  const read = responseCapture();
  await routeHandler(bankRouter, 'get', '/avaluation-templates/:id')(
    bankReq({ id: IDS.otherTemplate }), read.res
  );
  assert.equal(read.statusCode, 404);

  const activate = responseCapture();
  await routeHandler(bankRouter, 'patch', '/avaluation-templates/:id/activate')(
    bankReq({ id: IDS.otherTemplate }), activate.res
  );
  assert.equal(activate.statusCode, 404);
  assert.ok(filters.every(filter => filter.bankTenantKey === 'bank-a'));
});

test('activation retires only the current template of the same bank', async (t) => {
  mockAudit(t);
  const originals = {
    findOne: AvaluationTemplate.findOne,
    updateMany: AvaluationTemplate.updateMany,
    findOneAndUpdate: AvaluationTemplate.findOneAndUpdate
  };
  let retiredFilter;
  let activationFilter;
  t.after(() => Object.assign(AvaluationTemplate, originals));
  AvaluationTemplate.findOne = () => ({ lean: async () => template({ status: 'draft' }) });
  AvaluationTemplate.updateMany = async filter => { retiredFilter = filter; };
  AvaluationTemplate.findOneAndUpdate = filter => {
    activationFilter = filter;
    return { lean: async () => template() };
  };

  const capture = responseCapture();
  await routeHandler(bankRouter, 'patch', '/avaluation-templates/:id/activate')(
    bankReq({ id: IDS.template }), capture.res
  );
  assert.equal(capture.statusCode, 200);
  assert.equal(retiredFilter.bankTenantKey, 'bank-a');
  assert.equal(retiredFilter.status, 'active');
  assert.equal(activationFilter.bankTenantKey, 'bank-a');
  assert.equal(capture.payload.template.status, 'active');
});

test('cross-tenant project inspection snapshots the active template of the commissioning bank', async (t) => {
  const originals = {
    assignmentFindOne: ProjectAvaluatorAssignment.findOne,
    projectFindOne: Project.findOne,
    templateFindOne: AvaluationTemplate.findOne,
    inspectionFindOne: Inspection.findOne,
    inspectionCreate: Inspection.create
  };
  let templateFilter;
  let created;
  t.after(() => {
    ProjectAvaluatorAssignment.findOne = originals.assignmentFindOne;
    Project.findOne = originals.projectFindOne;
    AvaluationTemplate.findOne = originals.templateFindOne;
    Inspection.findOne = originals.inspectionFindOne;
    Inspection.create = originals.inspectionCreate;
  });
  ProjectAvaluatorAssignment.findOne = () => ({ lean: async () => assignment() });
  Project.findOne = () => ({ select: () => ({ lean: async () => ({ _id: IDS.project }) }) });
  AvaluationTemplate.findOne = filter => {
    templateFilter = filter;
    return { lean: async () => template() };
  };
  Inspection.findOne = () => ({ sort: () => ({ select: () => ({ lean: async () => null }) }) });
  Inspection.create = async value => {
    created = value;
    return structuredInspection(value);
  };

  const injected = responseCapture();
  await routeHandler(mobileRouter, 'post', '/projects/:projectId/inspections')(
    evaluatorReq({ projectId: IDS.project }, { templateId: IDS.otherTemplate }), injected.res
  );
  assert.equal(injected.statusCode, 400);

  const capture = responseCapture();
  await routeHandler(mobileRouter, 'post', '/projects/:projectId/inspections')(
    evaluatorReq({ projectId: IDS.project }, {}), capture.res
  );
  assert.equal(capture.statusCode, 201);
  assert.deepEqual(templateFilter, { bankTenantKey: 'bank-a', status: 'active' });
  assert.equal(created.projectTenantKey, 'project-owner-b');
  assert.equal(created.methodology.version, 3);
  assert.deepEqual(created.methodology.sections, SECTIONS);
  assert.equal(capture.payload.inspection.methodology.name, 'Metodo banco A');
});

test('inspection methodology snapshot remains unchanged when the source template changes', () => {
  const source = template();
  const snapshot = mobileRouter._helpers.methodologySnapshot(source);
  source.name = 'Metodo cambiado';
  source.version = 4;
  source.sections[0].name = 'Nombre cambiado';
  source.sections[0].weight = 5;

  assert.equal(snapshot.name, 'Metodo banco A');
  assert.equal(snapshot.version, 3);
  assert.equal(snapshot.sections[0].name, 'Estructura');
  assert.equal(snapshot.sections[0].weight, 40);
});

test('structured progress rejects invented fields, unknown keys and values outside 0..100', () => {
  const methodology = mobileRouter._helpers.methodologySnapshot(template());
  for (const input of [
    [{ key: 'inventada', progressPercent: 10 }],
    [{ key: 'estructura', name: 'Hack', progressPercent: 10 }],
    [{ key: 'estructura', weight: 100, progressPercent: 10 }],
    [{ key: 'estructura', progressPercent: -0.1 }],
    [{ key: 'estructura', progressPercent: 100.1 }],
    [{ key: 'estructura', progressPercent: 10 }, { key: 'estructura', progressPercent: 20 }]
  ]) {
    assert.ok(mobileRouter._helpers.structuredProgress(methodology, input).error);
  }
});

test('server calculates weighted structured progress and preserves template names and weights', async (t) => {
  mockStructuredAuthorization(t);
  const originals = {
    unitFindOne: Unit.findOne,
    itemFindOne: InspectionUnit.findOne,
    itemCreate: InspectionUnit.create
  };
  let created;
  t.after(() => {
    Unit.findOne = originals.unitFindOne;
    InspectionUnit.findOne = originals.itemFindOne;
    InspectionUnit.create = originals.itemCreate;
  });
  Unit.findOne = () => ({ select: () => ({ lean: async () => ({
    _id: IDS.unit, code: 'U-1', manzana: 'M', lote: '1', modelo: 'Casa'
  }) }) });
  InspectionUnit.findOne = () => ({ lean: async () => null });
  InspectionUnit.create = async value => {
    created = value;
    return {
      _id: IDS.inspectionUnit,
      ...value,
      createdAt: new Date(),
      updatedAt: new Date()
    };
  };

  const capture = responseCapture();
  await routeHandler(mobileRouter, 'put', '/inspections/:inspectionId/units/:unitId')(
    evaluatorReq(
      { inspectionId: IDS.inspection, unitId: IDS.unit },
      {
        progressSections: [
          { key: 'estructura', progressPercent: 100 },
          { key: 'acabados', progressPercent: 25 }
        ],
        observations: 'Calculo estructurado'
      }
    ),
    capture.res
  );
  assert.equal(capture.statusCode, 201);
  assert.equal(created.progressPercent, 55);
  assert.deepEqual(created.progressSections, [
    { ...SECTIONS[0], progressPercent: 100 },
    { ...SECTIONS[1], progressPercent: 25 }
  ]);
  assert.equal(capture.payload.inspectionUnit.progressPercent, 55);
  assert.equal(capture.payload.inspectionUnit.progressSections[0].name, 'Estructura');

  const forgedGlobal = responseCapture();
  await routeHandler(mobileRouter, 'put', '/inspections/:inspectionId/units/:unitId')(
    evaluatorReq(
      { inspectionId: IDS.inspection, unitId: IDS.unit },
      { progressPercent: 99, progressSections: [{ key: 'estructura', progressPercent: 1 }] }
    ),
    forgedGlobal.res
  );
  assert.equal(forgedGlobal.statusCode, 400);
});

test('legacy inspection without methodology still accepts and returns manual progress', async (t) => {
  mockStructuredAuthorization(t);
  Inspection.findOne = () => ({ lean: async () => structuredInspection({ methodology: undefined }) });
  const originals = {
    unitFindOne: Unit.findOne,
    itemFindOne: InspectionUnit.findOne,
    itemCreate: InspectionUnit.create
  };
  t.after(() => {
    Unit.findOne = originals.unitFindOne;
    InspectionUnit.findOne = originals.itemFindOne;
    InspectionUnit.create = originals.itemCreate;
  });
  Unit.findOne = () => ({ select: () => ({ lean: async () => ({ _id: IDS.unit }) }) });
  InspectionUnit.findOne = () => ({ lean: async () => null });
  InspectionUnit.create = async value => ({
    _id: IDS.inspectionUnit, ...value, createdAt: new Date(), updatedAt: new Date()
  });

  const capture = responseCapture();
  await routeHandler(mobileRouter, 'put', '/inspections/:inspectionId/units/:unitId')(
    evaluatorReq(
      { inspectionId: IDS.inspection, unitId: IDS.unit },
      { progressPercent: 42.5, observations: 'Legacy' }
    ),
    capture.res
  );
  assert.equal(capture.statusCode, 201);
  assert.equal(capture.payload.inspectionUnit.progressPercent, 42.5);
  assert.equal(capture.payload.inspectionUnit.progressSections, null);
});
