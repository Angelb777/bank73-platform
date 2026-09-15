'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const authRouter = require('../routes/auth');
const mobileRouter = require('../routes/mobileAvaluator');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const ProjectAvaluatorAssignment = require('../models/ProjectAvaluatorAssignment');
const { hashPassword } = require('../utils/passwords');
const { activeAvaluatorBankTenants } = require('../utils/tenants');

function handler(router, method, path) {
  return router.stack.find(layer =>
    layer.route?.path === path && layer.route.methods[method]
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

test('active bank memberships are independent and legacy evaluators remain compatible', () => {
  assert.deepEqual(activeAvaluatorBankTenants({
    role: 'avaluador',
    status: 'active',
    tenantKey: 'bank-a',
    tenantKeys: ['bank-a', 'bank-b'],
    avaluatorBankMemberships: [
      { bankTenantKey: 'bank-a', status: 'active' },
      { bankTenantKey: 'bank-b', status: 'blocked' }
    ]
  }), ['bank-a']);
  assert.deepEqual(activeAvaluatorBankTenants({
    role: 'avaluador', status: 'active', tenantKey: 'bank-a', tenantKeys: ['bank-a', 'bank-b']
  }), ['bank-a', 'bank-b']);
});

test('mobile login needs only email/password and issues all active bank tenants', async (t) => {
  const originalFind = User.find;
  const originalAuditCreate = AuditLog.create;
  const previousSecret = process.env.JWT_SECRET;
  t.after(() => {
    User.find = originalFind;
    AuditLog.create = originalAuditCreate;
    process.env.JWT_SECRET = previousSecret;
  });
  process.env.JWT_SECRET = 'test-mobile-multibank-secret';

  const evaluator = {
    _id: { toString: () => '64b000000000000000000001' },
    name: 'Avaluador compartido',
    email: 'shared@example.test',
    password: hashPassword('Password123!'),
    role: 'avaluador',
    status: 'active',
    tenantKey: 'bank-a',
    tenantKeys: ['bank-a', 'bank-b'],
    avaluatorBankMemberships: [
      { bankTenantKey: 'bank-a', status: 'active' },
      { bankTenantKey: 'bank-b', status: 'active' }
    ]
  };
  let userFilter;
  User.find = filter => {
    userFilter = filter;
    return { limit: async () => [evaluator] };
  };
  AuditLog.create = async () => ({});

  const capture = responseCapture();
  await handler(authRouter, 'post', '/mobile-login')({
    body: { email: evaluator.email, password: 'Password123!' }
  }, capture.res);

  assert.equal(capture.statusCode, 200);
  assert.equal(userFilter.role, 'avaluador');
  assert.deepEqual(capture.payload.tenantKeys, ['bank-a', 'bank-b']);
  assert.ok(capture.payload.token);
});

test('mobile assignment lookup accepts every active bank but no tenant outside membership', async (t) => {
  const originalFindOne = ProjectAvaluatorAssignment.findOne;
  let filter;
  t.after(() => { ProjectAvaluatorAssignment.findOne = originalFindOne; });
  ProjectAvaluatorAssignment.findOne = value => {
    filter = value;
    return { lean: async () => null };
  };

  await mobileRouter._helpers.activeAssignmentFor({
    user: {
      userId: '64b000000000000000000001',
      avaluatorBankTenantKeys: ['bank-a', 'bank-b']
    }
  }, '64b000000000000000000010');

  assert.deepEqual(filter.bankTenantKey, { $in: ['bank-a', 'bank-b'] });
  assert.equal(filter.avaluadorId, '64b000000000000000000001');
  assert.equal(filter.status, 'active');
});
