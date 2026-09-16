'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const mobileRouter = require('../routes/mobileAvaluator');
const Project = require('../models/Project');
const ProjectChecklist = require('../models/ProjectChecklist');
const Unit = require('../models/Unit');
const ProjectAvaluatorAssignment = require('../models/ProjectAvaluatorAssignment');
const denyAvaluatorBackoffice = require('../middleware/avaluatorBackoffice');

const IDS = {
  evaluatorA: '64b000000000000000000001',
  evaluatorB: '64b000000000000000000002',
  projectA: '64b000000000000000000010',
  projectB: '64b000000000000000000011',
  unitA: '64b000000000000000000020',
  unitB: '64b000000000000000000021'
};

function routeHandler(path) {
  return mobileRouter.stack.find(layer => layer.route?.path === path)?.route?.stack?.at(-1)?.handle;
}

function responseCapture() {
  const capture = { statusCode: 200, payload: null };
  capture.res = {
    status(code) { capture.statusCode = code; return this; },
    json(value) { capture.payload = value; return value; }
  };
  return capture;
}

function evaluatorReq(params = {}) {
  return {
    tenantKey: 'bank-a',
    user: {
      userId: IDS.evaluatorA,
      role: 'avaluador',
      status: 'active',
      tenantKey: 'bank-a',
      tenantKeys: ['bank-a']
    },
    params
  };
}

test('mobile API preserves the four project and unit read endpoints', () => {
  const routes = mobileRouter.stack.filter(layer => layer.route).map(layer => ({
    path: layer.route.path,
    methods: Object.keys(layer.route.methods)
  })).filter(route => [
    '/projects',
    '/projects/:projectId',
    '/projects/:projectId/units',
    '/projects/:projectId/units/:unitId'
  ].includes(route.path));

  assert.deepEqual(routes, [
    { path: '/projects', methods: ['get'] },
    { path: '/projects/:projectId', methods: ['get'] },
    { path: '/projects/:projectId/units', methods: ['get'] },
    { path: '/projects/:projectId/units/:unitId', methods: ['get'] }
  ]);
});

test('mobile API accepts only the avaluador role', () => {
  const roleGuard = mobileRouter.stack.find(layer => !layer.route).handle;
  const denied = responseCapture();
  let nextCalled = false;
  roleGuard({ user: { role: 'bank' } }, denied.res, () => { nextCalled = true; });
  assert.equal(denied.statusCode, 403);
  assert.equal(nextCalled, false);

  roleGuard({ user: { role: 'avaluador' } }, denied.res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('portfolio queries only active assignments for authenticated evaluator and bank tenant', async (t) => {
  const handler = routeHandler('/projects');
  const originalAssignmentFind = ProjectAvaluatorAssignment.find;
  const originalProjectFind = Project.find;
  let assignmentFilter;
  let projectFilter;
  let projectProjection;

  t.after(() => {
    ProjectAvaluatorAssignment.find = originalAssignmentFind;
    Project.find = originalProjectFind;
  });

  ProjectAvaluatorAssignment.find = filter => {
    assignmentFilter = filter;
    return { sort: () => ({ lean: async () => [{
      bankTenantKey: 'bank-a',
      projectTenantKey: 'project-owner',
      projectId: IDS.projectA,
      avaluadorId: IDS.evaluatorA,
      status: 'active'
    }] }) };
  };
  Project.find = filter => {
    projectFilter = filter;
    return {
      select(fields) {
        projectProjection = fields;
        return { lean: async () => [{
          _id: IDS.projectA,
          name: 'Proyecto A',
          description: 'No debe salir en portfolio',
          projectType: 'Residencial horizontal',
          location: 'Ubicacion A',
          address: 'Direccion A',
          city: 'Ciudad A',
          province: 'Provincia A',
          coordinates: { lat: 8.9, lng: -79.5 },
          coverImage: { path: '/cover.jpg', mimetype: 'image/jpeg', originalname: 'cover.jpg' },
          status: 'EN_CURSO',
          financialConditions: { projectTotal: 999999 }
        }] }
      }
    };
  };

  const capture = responseCapture();
  await handler(evaluatorReq(), capture.res);

  assert.equal(capture.statusCode, 200);
  assert.deepEqual(assignmentFilter, {
    bankTenantKey: { $in: ['bank-a'] },
    avaluadorId: IDS.evaluatorA,
    status: 'active'
  });
  assert.deepEqual(projectFilter.$or, [{ _id: IDS.projectA, tenantKey: 'project-owner' }]);
  assert.ok(!projectProjection.includes('description'));
  assert.deepEqual(capture.payload.projects[0], {
    id: IDS.projectA,
    name: 'Proyecto A',
    coverImage: { source: '/cover.jpg', mimetype: 'image/jpeg' },
    location: {
      label: 'Ubicacion A',
      address: 'Direccion A',
      city: 'Ciudad A',
      province: 'Provincia A',
      coordinates: { lat: 8.9, lng: -79.5 }
    },
    projectType: 'Residencial horizontal',
    status: 'EN_CURSO'
  });
  assert.equal('financialConditions' in capture.payload.projects[0], false);
});

test('revoked assignment leaves the portfolio empty', async (t) => {
  const handler = routeHandler('/projects');
  const originalAssignmentFind = ProjectAvaluatorAssignment.find;
  const originalProjectFind = Project.find;
  let projectQueried = false;

  t.after(() => {
    ProjectAvaluatorAssignment.find = originalAssignmentFind;
    Project.find = originalProjectFind;
  });
  ProjectAvaluatorAssignment.find = filter => {
    assert.equal(filter.status, 'active');
    return { sort: () => ({ lean: async () => [] }) };
  };
  Project.find = () => { projectQueried = true; };

  const capture = responseCapture();
  await handler(evaluatorReq(), capture.res);
  assert.deepEqual(capture.payload, { projects: [] });
  assert.equal(projectQueried, false);
});

test('project detail requires evaluator, bank tenant and project in the same active assignment', async (t) => {
  const checklistFind = ProjectChecklist.find;
  ProjectChecklist.find = () => ({ select: () => ({ lean: async () => [] }) });
  t.after(() => { ProjectChecklist.find = checklistFind; });
  const handler = routeHandler('/projects/:projectId');
  const originalAssignmentFindOne = ProjectAvaluatorAssignment.findOne;
  const originalProjectFindOne = Project.findOne;
  let assignmentFilter;
  let projectFilter;

  t.after(() => {
    ProjectAvaluatorAssignment.findOne = originalAssignmentFindOne;
    Project.findOne = originalProjectFindOne;
  });
  ProjectAvaluatorAssignment.findOne = filter => {
    assignmentFilter = filter;
    return { lean: async () => ({
      bankTenantKey: 'bank-a',
      projectTenantKey: 'project-owner',
      projectId: IDS.projectA,
      avaluadorId: IDS.evaluatorA,
      status: 'active'
    }) };
  };
  Project.findOne = filter => {
    projectFilter = filter;
    return { select: () => ({ lean: async () => ({
      _id: IDS.projectA,
      name: 'Proyecto A',
      description: 'Visita de obra',
      coordinates: {}
    }) }) };
  };

  const capture = responseCapture();
  await handler(evaluatorReq({ projectId: IDS.projectA }), capture.res);
  assert.equal(capture.statusCode, 200);
  assert.deepEqual(assignmentFilter.bankTenantKey, { $in: ['bank-a'] });
  assert.equal(assignmentFilter.avaluadorId, IDS.evaluatorA);
  assert.equal(assignmentFilter.status, 'active');
  assert.deepEqual(projectFilter, { _id: IDS.projectA, tenantKey: 'project-owner' });
  assert.equal(capture.payload.project.description, 'Visita de obra');
});

test('unassigned project returns 404 without loading Project', async (t) => {
  const handler = routeHandler('/projects/:projectId');
  const originalAssignmentFindOne = ProjectAvaluatorAssignment.findOne;
  const originalProjectFindOne = Project.findOne;
  let projectQueried = false;

  t.after(() => {
    ProjectAvaluatorAssignment.findOne = originalAssignmentFindOne;
    Project.findOne = originalProjectFindOne;
  });
  ProjectAvaluatorAssignment.findOne = () => ({ lean: async () => null });
  Project.findOne = () => { projectQueried = true; };

  const capture = responseCapture();
  await handler(evaluatorReq({ projectId: IDS.projectB }), capture.res);
  assert.equal(capture.statusCode, 404);
  assert.equal(projectQueried, false);
});

test('unit list is scoped by assigned project and project tenant and excludes buyer data', async (t) => {
  const handler = routeHandler('/projects/:projectId/units');
  const originalAssignmentFindOne = ProjectAvaluatorAssignment.findOne;
  const originalProjectFindOne = Project.findOne;
  const originalUnitFind = Unit.find;
  let unitFilter;
  let unitProjection;

  t.after(() => {
    ProjectAvaluatorAssignment.findOne = originalAssignmentFindOne;
    Project.findOne = originalProjectFindOne;
    Unit.find = originalUnitFind;
  });
  ProjectAvaluatorAssignment.findOne = () => ({ lean: async () => ({
    bankTenantKey: 'bank-a', projectTenantKey: 'project-owner',
    projectId: IDS.projectA, avaluadorId: IDS.evaluatorA, status: 'active'
  }) });
  Project.findOne = () => ({ select: () => ({ lean: async () => ({ _id: IDS.projectA }) }) });
  Unit.find = filter => {
    unitFilter = filter;
    return {
      select(fields) {
        unitProjection = fields;
        return { sort: () => ({ lean: async () => [{
          _id: IDS.unitA,
          code: 'M-1', manzana: 'M', lote: '1', modelo: 'Casa A',
          ubicacion: 'Sector 1', m2: 100, areaAbierta: 20,
          areaCerrada: 80, areaTotalConstruccion: 100,
          estado: 'disponible', clienteId: 'private-client', precioLista: 200000
        }] }) }
      }
    };
  };

  const capture = responseCapture();
  await handler(evaluatorReq({ projectId: IDS.projectA }), capture.res);
  assert.deepEqual(unitFilter, {
    tenantKey: 'project-owner',
    projectId: IDS.projectA,
    deletedAt: null
  });
  assert.ok(!unitProjection.includes('clienteId'));
  assert.ok(!unitProjection.includes('precioLista'));
  assert.equal('clienteId' in capture.payload.units[0], false);
  assert.equal('precioLista' in capture.payload.units[0], false);
  assert.equal(capture.payload.units[0].surfaces.totalConstructionM2, 100);
});

test('unit detail cannot be obtained with an ID from another project or tenant', async (t) => {
  const handler = routeHandler('/projects/:projectId/units/:unitId');
  const originalAssignmentFindOne = ProjectAvaluatorAssignment.findOne;
  const originalProjectFindOne = Project.findOne;
  const originalUnitFindOne = Unit.findOne;
  let unitFilter;

  t.after(() => {
    ProjectAvaluatorAssignment.findOne = originalAssignmentFindOne;
    Project.findOne = originalProjectFindOne;
    Unit.findOne = originalUnitFindOne;
  });
  ProjectAvaluatorAssignment.findOne = () => ({ lean: async () => ({
    bankTenantKey: 'bank-a', projectTenantKey: 'project-owner',
    projectId: IDS.projectA, avaluadorId: IDS.evaluatorA, status: 'active'
  }) });
  Project.findOne = () => ({ select: () => ({ lean: async () => ({ _id: IDS.projectA }) }) });
  Unit.findOne = filter => {
    unitFilter = filter;
    return { select: () => ({ lean: async () => null }) };
  };

  const capture = responseCapture();
  await handler(evaluatorReq({ projectId: IDS.projectA, unitId: IDS.unitB }), capture.res);
  assert.equal(capture.statusCode, 404);
  assert.deepEqual(unitFilter, {
    _id: IDS.unitB,
    tenantKey: 'project-owner',
    projectId: IDS.projectA,
    deletedAt: null
  });
});

test('assignment lookup cannot cross evaluator or bank boundaries', async (t) => {
  const originalAssignmentFindOne = ProjectAvaluatorAssignment.findOne;
  let filter;
  t.after(() => { ProjectAvaluatorAssignment.findOne = originalAssignmentFindOne; });
  ProjectAvaluatorAssignment.findOne = value => {
    filter = value;
    return { lean: async () => null };
  };

  const result = await mobileRouter._helpers.activeAssignmentFor(
    evaluatorReq({ projectId: IDS.projectB }),
    IDS.projectB
  );
  assert.equal(result, null);
  assert.deepEqual(filter.bankTenantKey, { $in: ['bank-a'] });
  assert.equal(filter.avaluadorId, IDS.evaluatorA);
  assert.notEqual(filter.avaluadorId, IDS.evaluatorB);
  assert.equal(filter.status, 'active');
});

test('existing backoffice guard remains unchanged for avaluador', () => {
  const capture = responseCapture();
  let nextCalled = false;
  denyAvaluatorBackoffice(evaluatorReq(), capture.res, () => { nextCalled = true; });
  assert.equal(capture.statusCode, 403);
  assert.equal(nextCalled, false);
});
