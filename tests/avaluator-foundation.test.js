'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const User = require('../models/User');
const ProjectAvaluatorAssignment = require('../models/ProjectAvaluatorAssignment');
const denyAvaluatorBackoffice = require('../middleware/avaluatorBackoffice');
const bankRouter = require('../routes/bank');
const Project = require('../models/Project');
const AuditLog = require('../models/AuditLog');
const { FULL_ACCESS_ROLES, LIMITED_AREA_ROLES } = require('../utils/roles');

function routeHandler(method, path) {
  const layer = bankRouter.stack.find(item =>
    item.route?.path === path && item.route.methods[String(method).toLowerCase()]
  );
  return layer?.route?.stack?.at(-1)?.handle;
}

function responseCapture() {
  const capture = { statusCode: 200, payload: null };
  capture.res = {
    status(code) { capture.statusCode = code; return this; },
    json(value) { capture.payload = value; return value; }
  };
  return capture;
}

test('avaluador is valid but cannot be requested in public registration', async () => {
  assert.ok(User.ROLES.includes('avaluador'));
  assert.ok(!User.REQUESTABLE_ROLES.includes('avaluador'));
  assert.ok(!FULL_ACCESS_ROLES.includes('avaluador'));
  assert.ok(!LIMITED_AREA_ROLES.includes('avaluador'));

  const user = new User({
    tenantKey: 'bank-a',
    tenantKeys: ['bank-a'],
    name: 'Avaluador',
    email: 'avaluador@example.test',
    password: 'hashed-placeholder',
    role: 'avaluador',
    roleRequested: null,
    status: 'pending'
  });
  await user.validate();
  assert.equal(user.role, 'avaluador');
  assert.equal(user.roleRequested, null);
});

test('existing role permissions remain unchanged', () => {
  assert.deepEqual(FULL_ACCESS_ROLES, [
    'admin', 'bank', 'promoter', 'gerencia', 'socios', 'financiero', 'contable'
  ]);
  assert.deepEqual(LIMITED_AREA_ROLES, ['commercial', 'legal', 'tecnico']);
});

test('avaluador is explicitly denied access to protected backoffice routes', () => {
  let statusCode;
  let payload;
  let nextCalled = false;
  const res = {
    status(code) { statusCode = code; return this; },
    json(value) { payload = value; return value; }
  };

  denyAvaluatorBackoffice({ user: { role: 'avaluador' } }, res, () => { nextCalled = true; });
  assert.equal(statusCode, 403);
  assert.equal(nextCalled, false);
  assert.match(payload.error, /no tiene acceso al backoffice/i);

  nextCalled = false;
  denyAvaluatorBackoffice({ user: { role: 'commercial' } }, res, () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('assignment model requires separate bank and project tenants and has a unique identity', async () => {
  const assignment = new ProjectAvaluatorAssignment({
    bankTenantKey: 'bank-a',
    projectTenantKey: 'promoter-a',
    projectId: '64b000000000000000000001',
    avaluadorId: '64b000000000000000000002',
    assignedBy: '64b000000000000000000003'
  });
  await assignment.validate();
  assert.equal(assignment.status, 'active');
  assert.equal(assignment.bankTenantKey, 'bank-a');
  assert.equal(assignment.projectTenantKey, 'promoter-a');

  const uniqueIndex = ProjectAvaluatorAssignment.schema.indexes().find(([fields, options]) =>
    options.unique === true &&
    fields.bankTenantKey === 1 &&
    fields.projectId === 1 &&
    fields.avaluadorId === 1
  );
  assert.ok(uniqueIndex, 'missing unique bank/project/avaluador index');
});

test('bank router exposes only the minimum avaluador management endpoints', () => {
  const routes = bankRouter.stack
    .filter(layer => layer.route)
    .map(layer => `${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);

  for (const expected of [
    'GET /avaluadores',
    'POST /avaluadores',
    'PATCH /avaluadores/:id/status',
    'GET /projects/:projectId/avaluadores',
    'PUT /projects/:projectId/avaluadores/:avaluadorId',
    'DELETE /projects/:projectId/avaluadores/:avaluadorId'
  ]) {
    assert.ok(routes.includes(expected), `missing ${expected}`);
  }
});

test('bank-created avaluador always belongs to the authenticated bank tenant', async (t) => {
  const handler = routeHandler('post', '/avaluadores');
  const originalFind = User.find;
  const originalCreate = User.create;
  const originalAuditCreate = AuditLog.create;
  let createdPayload;

  t.after(() => {
    User.find = originalFind;
    User.create = originalCreate;
    AuditLog.create = originalAuditCreate;
  });

  User.find = () => ({ limit: async () => [] });
  User.create = async payload => {
    createdPayload = payload;
    return { _id: '64b000000000000000000010', ...payload };
  };
  AuditLog.create = async () => ({});

  const capture = responseCapture();
  await handler({
    tenantKey: 'bank-a',
    user: { userId: '64b000000000000000000001', tenantKeys: ['bank-a'] },
    body: {
      tenantKey: 'bank-b',
      name: 'Avaluador A',
      email: 'avaluador@example.test',
      temporaryPassword: 'Password123!'
    }
  }, capture.res);

  assert.equal(capture.statusCode, 201);
  assert.equal(createdPayload.tenantKey, 'bank-a');
  assert.deepEqual(createdPayload.tenantKeys, ['bank-a']);
  assert.equal(createdPayload.role, 'avaluador');
  assert.equal(createdPayload.status, 'pending');
  assert.equal(createdPayload.avaluatorBankMemberships[0].bankTenantKey, 'bank-a');
  assert.notEqual(createdPayload.password, 'Password123!');
});

test('a second bank invites the same evaluator identity without duplicating the user', async (t) => {
  const handler = routeHandler('post', '/avaluadores');
  const originalFind = User.find;
  const originalCreate = User.create;
  const originalAuditCreate = AuditLog.create;
  const existing = {
    _id: '64b000000000000000000010',
    tenantKey: 'bank-a',
    tenantKeys: ['bank-a'],
    avaluatorBankMemberships: [{ bankTenantKey: 'bank-a', status: 'active' }],
    name: 'Avaluador compartido',
    email: 'shared@example.test',
    role: 'avaluador',
    status: 'active',
    async save() { this.saved = true; }
  };
  let createCalled = false;

  t.after(() => {
    User.find = originalFind;
    User.create = originalCreate;
    AuditLog.create = originalAuditCreate;
  });
  User.find = () => ({ limit: async () => [existing] });
  User.create = async () => { createCalled = true; };
  AuditLog.create = async () => ({});

  const capture = responseCapture();
  await handler({
    tenantKey: 'bank-b',
    user: { userId: '64b000000000000000000002', tenantKeys: ['bank-b'] },
    body: {
      name: 'Avaluador compartido',
      email: 'shared@example.test',
      temporaryPassword: 'IgnoredPassword123!'
    }
  }, capture.res);

  assert.equal(capture.statusCode, 201);
  assert.equal(createCalled, false);
  assert.equal(existing.saved, true);
  assert.deepEqual(existing.tenantKeys, ['bank-a', 'bank-b']);
  assert.equal(existing.avaluatorBankMemberships.find(item => item.bankTenantKey === 'bank-b').status, 'pending');
});

test('bank cannot manage an avaluador whose primary tenant is different', async (t) => {
  const handler = routeHandler('patch', '/avaluadores/:id/status');
  const originalFindOne = User.findOne;
  let userFilter;

  t.after(() => { User.findOne = originalFindOne; });
  User.findOne = async filter => {
    userFilter = filter;
    return null;
  };

  const capture = responseCapture();
  await handler({
    tenantKey: 'bank-a',
    user: { tenantKeys: ['bank-a'] },
    params: { id: '64b000000000000000000010' },
    body: { status: 'blocked', tenantKey: 'bank-b' }
  }, capture.res);

  assert.equal(capture.statusCode, 404);
  assert.deepEqual(userFilter.$or, [{ tenantKey: 'bank-a' }, { tenantKeys: 'bank-a' }]);
  assert.equal(userFilter.role, 'avaluador');
});

test('cross-tenant assignment persists bank and project tenants separately', async (t) => {
  const handler = routeHandler('put', '/projects/:projectId/avaluadores/:avaluadorId');
  const originalUserFind = User.find;
  const originalUserFindOne = User.findOne;
  const originalProjectFindOne = Project.findOne;
  const originalAssignmentUpdate = ProjectAvaluatorAssignment.findOneAndUpdate;
  const originalAuditCreate = AuditLog.create;
  let evaluatorFilter;
  let projectFilter;
  let assignmentFilter;
  let assignmentUpdate;

  t.after(() => {
    User.find = originalUserFind;
    User.findOne = originalUserFindOne;
    Project.findOne = originalProjectFindOne;
    ProjectAvaluatorAssignment.findOneAndUpdate = originalAssignmentUpdate;
    AuditLog.create = originalAuditCreate;
  });

  User.find = () => ({ select: () => ({ lean: async () => [{ _id: '64b000000000000000000001' }] }) });
  Project.findOne = filter => {
    projectFilter = filter;
    return { lean: async () => ({
    _id: '64b000000000000000000020',
    tenantKey: 'project-owner',
    publishStatus: 'approved'
    }) };
  };
  User.findOne = filter => {
    evaluatorFilter = filter;
    return { select: () => ({ lean: async () => ({
      _id: '64b000000000000000000030',
      tenantKey: 'bank-a',
      role: 'avaluador',
      status: 'active'
    }) }) };
  };
  ProjectAvaluatorAssignment.findOneAndUpdate = async (filter, update) => {
    assignmentFilter = filter;
    assignmentUpdate = update;
    return { ...filter, ...update.$set };
  };
  AuditLog.create = async () => ({});

  const capture = responseCapture();
  await handler({
    tenantKey: 'bank-a',
    user: { userId: '64b000000000000000000001', tenantKeys: ['bank-a'] },
    params: {
      projectId: '64b000000000000000000020',
      avaluadorId: '64b000000000000000000030'
    },
    body: { bankTenantKey: 'bank-b', projectTenantKey: 'spoofed' }
  }, capture.res);

  assert.equal(capture.statusCode, 200);
  assert.equal(projectFilter.publishStatus, 'approved');
  assert.deepEqual(projectFilter.$or[0], { tenantKey: 'bank-a' });
  assert.ok(projectFilter.$or[1].$or.some(condition => condition.assignedBanks));
  assert.deepEqual(evaluatorFilter.$or, [{ tenantKey: 'bank-a' }, { tenantKeys: 'bank-a' }]);
  assert.equal(evaluatorFilter.status, 'active');
  assert.equal(assignmentFilter.bankTenantKey, 'bank-a');
  assert.equal(assignmentUpdate.$set.projectTenantKey, 'project-owner');
  assert.equal(assignmentUpdate.$set.status, 'active');
});

test('revocation targets only an active assignment owned by the bank tenant', async (t) => {
  const handler = routeHandler('delete', '/projects/:projectId/avaluadores/:avaluadorId');
  const originalUserFindOne = User.findOne;
  const originalAssignmentUpdate = ProjectAvaluatorAssignment.findOneAndUpdate;
  const originalAuditCreate = AuditLog.create;
  let assignmentFilter;

  t.after(() => {
    User.findOne = originalUserFindOne;
    ProjectAvaluatorAssignment.findOneAndUpdate = originalAssignmentUpdate;
    AuditLog.create = originalAuditCreate;
  });

  User.findOne = () => ({ select: () => ({ lean: async () => ({ _id: '64b000000000000000000030' }) }) });
  ProjectAvaluatorAssignment.findOneAndUpdate = async (filter, update) => {
    assignmentFilter = filter;
    return {
      ...filter,
      ...update.$set,
      projectTenantKey: 'project-owner'
    };
  };
  AuditLog.create = async () => ({});

  const capture = responseCapture();
  await handler({
    tenantKey: 'bank-a',
    user: { userId: '64b000000000000000000001', tenantKeys: ['bank-a'] },
    params: {
      projectId: '64b000000000000000000020',
      avaluadorId: '64b000000000000000000030'
    },
    body: { bankTenantKey: 'bank-b' }
  }, capture.res);

  assert.equal(capture.statusCode, 200);
  assert.equal(assignmentFilter.bankTenantKey, 'bank-a');
  assert.equal(assignmentFilter.status, 'active');
  assert.equal(capture.payload.assignment.status, 'revoked');
});
