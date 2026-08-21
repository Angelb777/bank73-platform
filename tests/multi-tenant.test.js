'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { assignedTenantList } = require('../utils/tenants');
const User = require('../models/User');
const Project = require('../models/Project');
const AuditLog = require('../models/AuditLog');
const bankRouter = require('../routes/bank');
const projectsRouter = require('../routes/projects');
const { requireProjectAccess } = require('../middleware/rbac');

test('bank without assigned tenants can use bancodemo as the isolated fallback', () => {
  assert.deepEqual(assignedTenantList({
    role: 'bank',
    tenantKey: 'bancodemo',
    tenantKeys: []
  }), ['bancodemo']);
});

test('bank with assigned tenants keeps the existing assignment behavior', () => {
  assert.deepEqual(assignedTenantList({
    role: 'bank',
    tenantKey: 'bancodemo',
    tenantKeys: ['allbank-corp']
  }), ['allbank-corp']);
});

test('bank dashboard activity is queried by the active tenant only', async (t) => {
  const dashboardLayer = bankRouter.stack.find(layer => layer.route?.path === '/dashboard');
  const dashboardHandler = dashboardLayer.route.stack.at(-1).handle;
  let auditFilter;
  let userFilter;
  let projectFilter;

  const originalUserFind = User.find;
  const originalProjectFind = Project.find;
  const originalAuditFind = AuditLog.find;

  t.after(() => {
    User.find = originalUserFind;
    Project.find = originalProjectFind;
    AuditLog.find = originalAuditFind;
  });

  User.find = filter => {
    userFilter = filter;
    return ({
    sort: () => ({
      limit: () => ({ lean: async () => [] })
    })
    });
  };
  Project.find = filter => {
    projectFilter = filter;
    return ({ sort: () => ({ lean: async () => [] }) });
  };
  AuditLog.find = filter => {
    auditFilter = filter;
    return {
      sort: () => ({
        limit: () => ({ lean: async () => [] })
      })
    };
  };

  let payload;
  const req = {
    user: { role: 'bank', tenantKeys: ['allbank-corp', 'other-bank'] },
    tenantKey: 'allbank-corp'
  };
  const res = {
    json(value) {
      payload = value;
      return value;
    },
    status() {
      return this;
    }
  };

  await dashboardHandler(req, res);

  assert.deepEqual(userFilter, {
    $or: [{ tenantKey: 'allbank-corp' }, { tenantKeys: 'allbank-corp' }]
  });
  assert.deepEqual(projectFilter, { tenantKey: 'allbank-corp' });
  assert.deepEqual(auditFilter, { tenantKey: 'allbank-corp' });
  assert.deepEqual(payload.logs, []);
});

test('bank portfolio includes projects assigned to another user in the active tenant', async (t) => {
  const portfolioLayer = projectsRouter.stack.find(layer => layer.route?.path === '/portfolio');
  const portfolioHandler = portfolioLayer.route.stack.at(-1).handle;
  const commercialId = '69e633f62456061d13472265';
  let projectFilter;

  const originalUserFind = User.find;
  const originalProjectFind = Project.find;

  t.after(() => {
    User.find = originalUserFind;
    Project.find = originalProjectFind;
  });

  User.find = () => ({
    select: () => ({ lean: async () => [{ _id: commercialId }] })
  });
  Project.find = filter => {
    projectFilter = filter;
    return { sort: () => ({ lean: async () => [] }) };
  };

  let payload;
  const req = {
    user: { role: 'bank' },
    tenantKey: 'allbank-corp',
    query: {}
  };
  const res = {
    json(value) {
      payload = value;
      return value;
    },
    status() {
      return this;
    }
  };

  await portfolioHandler(req, res);

  assert.deepEqual(payload, []);
  assert.equal(projectFilter.publishStatus, 'approved');
  assert.deepEqual(projectFilter.$or[0], { tenantKey: 'allbank-corp' });
  assert.deepEqual(
    projectFilter.$or[1].$or.find(condition => condition.assignedCommercials),
    { assignedCommercials: { $in: [commercialId] } }
  );
});

test('bank can open a project assigned to another member of the active tenant', async (t) => {
  const middleware = requireProjectAccess();
  let membershipFilter;
  let nextCalled = false;

  const originalFindById = Project.findById;
  const originalUserExists = User.exists;

  t.after(() => {
    Project.findById = originalFindById;
    User.exists = originalUserExists;
  });

  Project.findById = () => ({
    lean: async () => ({
      _id: 'project-id',
      tenantKey: 'bancodemo',
      publishStatus: 'approved',
      assignedCommercials: ['commercial-id']
    })
  });
  User.exists = async filter => {
    membershipFilter = filter;
    return { _id: 'commercial-id' };
  };

  const req = {
    method: 'GET',
    baseUrl: '/api/projects',
    path: '/project-id',
    params: { id: 'project-id' },
    body: {},
    query: {},
    headers: {},
    tenantKey: 'allbank-corp',
    tenant: { key: 'allbank-corp', tenantKey: 'allbank-corp' },
    user: {
      role: 'bank',
      userId: 'bank-id',
      tenantKey: 'allbank-corp',
      tenantKeys: ['allbank-corp']
    }
  };
  const res = {
    status() {
      return this;
    },
    json() {
      return this;
    }
  };

  await middleware(req, res, () => { nextCalled = true; });

  assert.equal(nextCalled, true);
  assert.deepEqual(membershipFilter.$or, [
    { tenantKey: 'allbank-corp' },
    { tenantKeys: 'allbank-corp' }
  ]);
  assert.equal(req.tenantKey, 'bancodemo');
});
