'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const Project = require('../models/Project');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const ProjectAvaluatorAssignment = require('../models/ProjectAvaluatorAssignment');
const projectsRouter = require('../routes/projects');

function routeHandler(method, routePath) {
  const layer = projectsRouter.stack.find(item =>
    item.route?.path === routePath && item.route.methods[String(method).toLowerCase()]
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

test('dashboard includes Avaluador in the project team selector', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'dashboard.js'),
    'utf8'
  );
  assert.match(source, /const ASSIGNABLE_ROLES = \[[\s\S]*?'avaluador'[\s\S]*?\];/);
  assert.match(source, /avaluador:\s*'Avaluador'/);
});

test('assignee candidates include only active avaluadores belonging to the active tenant', async t => {
  const handler = routeHandler('get', '/assignees');
  const originalFind = User.find;
  let receivedFilter;

  t.after(() => { User.find = originalFind; });
  User.find = filter => {
    receivedFilter = filter;
    return {
      sort() {
        return {
          lean: async () => [
            {
              _id: '64b000000000000000000011',
              role: 'avaluador',
              status: 'active',
              avaluatorBankMemberships: [{ bankTenantKey: 'bank-a', status: 'active' }]
            },
            {
              _id: '64b000000000000000000012',
              role: 'avaluador',
              status: 'active',
              avaluatorBankMemberships: [{ bankTenantKey: 'bank-a', status: 'blocked' }]
            }
          ]
        };
      }
    };
  };

  const capture = responseCapture();
  await handler({ tenantKey: 'bank-a', query: { role: 'avaluador' } }, capture.res);

  assert.equal(capture.statusCode, 200);
  assert.equal(receivedFilter.role, 'avaluador');
  assert.equal(receivedFilter.status, 'active');
  assert.deepEqual(receivedFilter.$or, [{ tenantKey: 'bank-a' }, { tenantKeys: 'bank-a' }]);
  assert.deepEqual(capture.payload.users.map(user => user._id), ['64b000000000000000000011']);
});

test('admin project assignment stores avaluadores in ProjectAvaluatorAssignment and revokes deselected ones', async t => {
  const handler = routeHandler('put', '/:id/assign');
  const originals = {
    userFind: User.find,
    projectFindOne: Project.findOne,
    projectFindOneAndUpdate: Project.findOneAndUpdate,
    assignmentUpdateMany: ProjectAvaluatorAssignment.updateMany,
    assignmentFindOneAndUpdate: ProjectAvaluatorAssignment.findOneAndUpdate,
    auditCreate: AuditLog.create
  };
  let projectUpdated = false;
  let revokeFilter;
  let assignmentFilter;
  let assignmentUpdate;

  t.after(() => {
    User.find = originals.userFind;
    Project.findOne = originals.projectFindOne;
    Project.findOneAndUpdate = originals.projectFindOneAndUpdate;
    ProjectAvaluatorAssignment.updateMany = originals.assignmentUpdateMany;
    ProjectAvaluatorAssignment.findOneAndUpdate = originals.assignmentFindOneAndUpdate;
    AuditLog.create = originals.auditCreate;
  });

  User.find = filter => ({
    select: () => ({
      lean: async () => [{
        _id: filter._id.$in[0],
        avaluatorBankMemberships: [{ bankTenantKey: 'bank-a', status: 'active' }]
      }]
    })
  });
  Project.findOne = async () => ({
    _id: '64b000000000000000000020',
    tenantKey: 'bank-a',
    name: 'Proyecto A'
  });
  Project.findOneAndUpdate = async () => { projectUpdated = true; };
  ProjectAvaluatorAssignment.updateMany = async filter => { revokeFilter = filter; };
  ProjectAvaluatorAssignment.findOneAndUpdate = async (filter, update) => {
    assignmentFilter = filter;
    assignmentUpdate = update;
    return { ...filter, ...update.$set };
  };
  AuditLog.create = async () => ({});

  const capture = responseCapture();
  await handler({
    tenantKey: 'bank-a',
    user: { userId: '64b000000000000000000001' },
    params: { id: '64b000000000000000000020' },
    body: { assignments: { avaluador: ['64b000000000000000000011'] } }
  }, capture.res);

  assert.equal(capture.statusCode, 200);
  assert.equal(projectUpdated, false, 'avaluadores must not be stored in Project');
  assert.equal(revokeFilter.bankTenantKey, 'bank-a');
  assert.equal(revokeFilter.projectId, '64b000000000000000000020');
  assert.deepEqual(revokeFilter.avaluadorId.$nin.map(String), ['64b000000000000000000011']);
  assert.equal(assignmentFilter.bankTenantKey, 'bank-a');
  assert.equal(String(assignmentFilter.avaluadorId), '64b000000000000000000011');
  assert.equal(assignmentUpdate.$set.projectTenantKey, 'bank-a');
  assert.equal(assignmentUpdate.$set.status, 'active');
  assert.equal(assignmentUpdate.$set.revokedAt, null);
});

test('admin project detail exposes active avaluadores without mutating the project model', async t => {
  const handler = routeHandler('get', '/:id');
  const originalProjectFindOne = Project.findOne;
  const originalAssignmentFind = ProjectAvaluatorAssignment.find;
  let assignmentFilter;

  t.after(() => {
    Project.findOne = originalProjectFindOne;
    ProjectAvaluatorAssignment.find = originalAssignmentFind;
  });

  Project.findOne = () => ({
    lean: async () => ({
      _id: '64b000000000000000000020',
      tenantKey: 'bank-a',
      name: 'Proyecto A',
      publishStatus: 'approved'
    })
  });
  ProjectAvaluatorAssignment.find = filter => {
    assignmentFilter = filter;
    return {
      select: () => ({
        lean: async () => [{ avaluadorId: '64b000000000000000000011' }]
      })
    };
  };

  const capture = responseCapture();
  await handler({
    tenantKey: 'bank-a',
    user: { role: 'admin' },
    params: { id: '64b000000000000000000020' }
  }, capture.res);

  assert.equal(capture.statusCode, 200);
  assert.equal(assignmentFilter.bankTenantKey, 'bank-a');
  assert.equal(assignmentFilter.projectTenantKey, 'bank-a');
  assert.equal(assignmentFilter.status, 'active');
  assert.deepEqual(capture.payload.assignees.avaluador, ['64b000000000000000000011']);
  assert.equal(Project.schema.path('assignedAvaluadores'), undefined);
});
