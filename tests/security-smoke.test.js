/* eslint-env node */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');
const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Project = require('../models/Project');
const Document = require('../models/Document');
const Unit = require('../models/Unit');
const UnitDocFolder = require('../models/UnitDocFolder');
const ProjectChecklist = require('../models/ProjectChecklist');
const ChatMessage = require('../models/ChatMessage');
const Budget = require('../models/Budget');
const Loan = require('../models/Loan');
const Milestone = require('../models/Milestone');
const ProjectFinance = require('../models/ProjectFinance');
const ProjectPermit = require('../models/ProjectPermit');
const { hashPassword } = require('../utils/passwords');

const ROOT = path.resolve(__dirname, '..');
const TENANT = 'security-smoke-tenant';
const OTHER_TENANT = 'security-smoke-other';
const PASSWORD = 'SecuritySmoke123!';
const PORT = Number(process.env.SECURITY_TEST_PORT || 3199);
const BASE_URL = `http://127.0.0.1:${PORT}`;
const MONGO_CONNECT_OPTIONS = {
  serverSelectionTimeoutMS: Number(process.env.SECURITY_TEST_MONGO_TIMEOUT_MS || 8000)
};

function buildTestMongoUri() {
  const explicit = process.env.TEST_MONGO_URI || process.env.TRUSTFORBANKS_TEST_MONGO_URI;
  const allowFallback = process.env.SECURITY_TEST_ALLOW_MONGO_URI_FALLBACK === '1';
  const source = explicit || (allowFallback ? process.env.MONGO_URI : null);
  if (!source) return null;

  const dbName = `trustforbanks_security_test_${process.pid}_${Date.now()}`;
  const url = new URL(source);
  url.pathname = `/${dbName}`;
  return { uri: url.toString(), dbName };
}

async function waitForHealth() {
  const deadline = Date.now() + 20000;
  let lastError;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return;
      lastError = new Error(`health ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }

  throw lastError || new Error('server did not become healthy');
}

async function api(pathname, { token, tenant = TENANT, method = 'GET', body, headers = {} } = {}) {
  const finalHeaders = { 'x-tenant': tenant, ...headers };
  let finalBody = body;

  if (token) finalHeaders.Authorization = `Bearer ${token}`;
  if (body && !(body instanceof FormData)) {
    finalHeaders['Content-Type'] = 'application/json';
    finalBody = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${pathname}`, {
    method,
    headers: finalHeaders,
    body: finalBody
  });

  const contentType = res.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await res.json().catch(() => null)
    : await res.text().catch(() => '');

  return { status: res.status, ok: res.ok, payload, headers: res.headers };
}

async function seedData() {
  const admin = await User.create({
    tenantKey: TENANT,
    tenantKeys: [TENANT],
    name: 'Security Admin',
    email: 'security.admin@example.test',
    password: hashPassword(PASSWORD),
    role: 'admin',
    status: 'active'
  });

  const assigned = await User.create({
    tenantKey: TENANT,
    tenantKeys: [TENANT],
    name: 'Assigned Commercial',
    email: 'assigned.commercial@example.test',
    password: hashPassword(PASSWORD),
    role: 'commercial',
    status: 'active'
  });

  const unassigned = await User.create({
    tenantKey: TENANT,
    tenantKeys: [TENANT],
    name: 'Unassigned Commercial',
    email: 'unassigned.commercial@example.test',
    password: hashPassword(PASSWORD),
    role: 'commercial',
    status: 'active'
  });

  const projectAllowed = await Project.create({
    tenantKey: TENANT,
    name: 'Allowed Project',
    publishStatus: 'approved',
    assignedCommercials: [assigned._id],
    assignees: { commercial: [assigned._id] }
  });

  const projectDenied = await Project.create({
    tenantKey: TENANT,
    name: 'Denied Project',
    publishStatus: 'approved'
  });

  const otherTenantProject = await Project.create({
    tenantKey: OTHER_TENANT,
    name: 'Other Tenant Project',
    publishStatus: 'approved'
  });

  const unitDenied = await Unit.create({
    tenantKey: TENANT,
    projectId: projectDenied._id,
    manzana: 'B',
    lote: '1',
    estado: 'disponible'
  });

  const folderDenied = await UnitDocFolder.create({
    tenantKey: TENANT,
    projectId: projectDenied._id,
    unitId: unitDenied._id,
    department: 'commercial',
    name: 'Denied Folder'
  });

  const checklistDenied = await ProjectChecklist.create({
    tenantKey: TENANT,
    projectId: projectDenied._id,
    title: 'Denied Checklist',
    phase: 'PREESTUDIOS',
    level: 1,
    roleOwner: 'commercial',
    visibleToRoles: ['commercial']
  });

  const documentDenied = await Document.create({
    tenantKey: TENANT,
    projectId: projectDenied._id,
    unitId: unitDenied._id,
    folderId: folderDenied._id,
    department: 'commercial',
    folder: 'comercial',
    originalname: 'denied.pdf',
    filename: 'denied.pdf',
    path: 'uploads/denied.pdf',
    mimetype: 'application/pdf',
    size: 10,
    visibleToRoles: ['commercial'],
    status: 'ACTIVE'
  });

  const messageDenied = await ChatMessage.create({
    tenantKey: TENANT,
    projectId: projectDenied._id,
    userId: admin._id,
    userEmail: admin.email,
    userName: admin.name,
    text: 'Denied message'
  });

  await Promise.all([
    Budget.create({ tenantKey: TENANT, projectId: projectAllowed._id, amountApproved: 1000 }),
    Loan.create({ tenantKey: TENANT, projectId: projectAllowed._id, amountApproved: 1000 }),
    Milestone.create({ tenantKey: TENANT, projectId: projectAllowed._id, name: 'Allowed milestone' }),
    ProjectFinance.create({ tenantKey: TENANT, project: projectAllowed._id, phases: [] }),
    ProjectPermit.create({
      tenantKey: TENANT,
      projectId: projectAllowed._id,
      items: [{ code: 'P1', title: 'Permit 1', status: 'pending' }]
    })
  ]);

  return {
    admin,
    assigned,
    unassigned,
    projectAllowed,
    projectDenied,
    otherTenantProject,
    unitDenied,
    folderDenied,
    checklistDenied,
    documentDenied,
    messageDenied
  };
}

async function login(email, tenant = TENANT) {
  const res = await api('/api/auth/login', {
    tenant,
    method: 'POST',
    body: { email, password: PASSWORD }
  });
  assert.equal(res.status, 200, `login failed for ${email}: ${JSON.stringify(res.payload)}`);
  assert.ok(res.payload.token);
  return res.payload.token;
}

function assertForbidden(res, label) {
  assert.equal(res.status, 403, `${label} expected 403, got ${res.status}: ${JSON.stringify(res.payload)}`);
}

function assertNoBypass(res, label) {
  assert.ok([403, 404].includes(res.status), `${label} expected 403/404, got ${res.status}: ${JSON.stringify(res.payload)}`);
}

const mongoTarget = buildTestMongoUri();

test('security integration smoke: tenant isolation, project access, IDOR and uploads', { skip: !mongoTarget && 'TEST_MONGO_URI or TRUSTFORBANKS_TEST_MONGO_URI is required' }, async (t) => {
  process.env.JWT_SECRET = process.env.JWT_SECRET || 'security-smoke-secret';
  process.env.NODE_ENV = 'test';

  try {
    await mongoose.connect(mongoTarget.uri, MONGO_CONNECT_OPTIONS);
  } catch (err) {
    t.skip(`Mongo de test no accesible: ${err.message}`);
    return;
  }
  await mongoose.connection.dropDatabase();
  const fixtures = await seedData();
  await mongoose.disconnect();

  const server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      MONGO_URI: mongoTarget.uri,
      JWT_SECRET: process.env.JWT_SECRET,
      NODE_ENV: 'test'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  let serverOutput = '';
  server.stdout.on('data', chunk => { serverOutput += chunk.toString(); });
  server.stderr.on('data', chunk => { serverOutput += chunk.toString(); });

  t.after(async () => {
    server.kill('SIGTERM');
    await new Promise(resolve => server.once('exit', resolve));
    await mongoose.connect(mongoTarget.uri, MONGO_CONNECT_OPTIONS);
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  try {
    await waitForHealth();
  } catch (err) {
    throw new Error(`${err.message}\n${serverOutput}`);
  }

  const adminToken = await login(fixtures.admin.email);
  const assignedToken = await login(fixtures.assigned.email);
  const unassignedToken = await login(fixtures.unassigned.email);

  await t.test('login and /api/auth/me expose expected role and tenants', async () => {
    const me = await api('/api/auth/me', { token: adminToken });
    assert.equal(me.status, 200);
    assert.equal(me.payload.role, 'admin');
    assert.equal(me.payload.tenantKey, TENANT);
    assert.deepEqual(me.payload.tenantKeys, [TENANT]);
  });

  await t.test('x-tenant manipulation is normalized to assigned tenant', async () => {
    const me = await api('/api/auth/me', { token: adminToken, tenant: 'not-assigned-tenant' });
    assert.equal(me.status, 200);
    assert.equal(me.payload.tenantKey, TENANT);

    const projects = await api('/api/projects', { token: adminToken, tenant: 'not-assigned-tenant' });
    assert.equal(projects.status, 200);
    assert.ok(projects.payload.every(p => p.tenantKey === TENANT));
  });

  await t.test('unassigned user receives 403 for projectId-based resources', async () => {
    const deniedId = fixtures.projectDenied._id;
    const endpoints = [
      ['finance', `/api/projects/${deniedId}/finance`],
      ['chat', `/api/chat/projects/${deniedId}`],
      ['documents', `/api/documents?projectId=${deniedId}`],
      ['permits', `/api/permits?projectId=${deniedId}`],
      ['process', `/api/projects/${deniedId}/checklists`],
      ['budget', `/api/budget/${deniedId}`],
      ['inventory', `/api/inventory/${deniedId}`],
      ['loans', `/api/loans/${deniedId}`],
      ['milestones', `/api/milestones?projectId=${deniedId}`],
      ['export', `/api/export/comercial.csv?projectId=${deniedId}`]
    ];

    for (const [label, endpoint] of endpoints) {
      const res = await api(endpoint, { token: unassignedToken });
      assertForbidden(res, label);
    }
  });

  await t.test('assigned user can access expected assigned-project resources', async () => {
    const allowedId = fixtures.projectAllowed._id;
    const endpoints = [
      ['finance', `/api/projects/${allowedId}/finance`],
      ['chat', `/api/chat/projects/${allowedId}`],
      ['documents', `/api/documents?projectId=${allowedId}`],
      ['permits', `/api/permits?projectId=${allowedId}`],
      ['process', `/api/projects/${allowedId}/checklists`],
      ['budget', `/api/budget/${allowedId}`],
      ['inventory', `/api/inventory/${allowedId}`],
      ['loans', `/api/loans/${allowedId}`],
      ['milestones', `/api/milestones?projectId=${allowedId}`],
      ['export', `/api/export/comercial.csv?projectId=${allowedId}`]
    ];

    for (const [label, endpoint] of endpoints) {
      const res = await api(endpoint, { token: assignedToken });
      assert.ok(res.status < 400, `${label} expected success, got ${res.status}: ${JSON.stringify(res.payload)}`);
    }
  });

  await t.test('direct IDs cannot bypass parent project access', async () => {
    const checks = [
      ['documentId', `/api/documents/${fixtures.documentDenied._id}/download`, { method: 'GET' }],
      ['folderId', `/api/unit-doc-folders/${fixtures.folderDenied._id}`, { method: 'PATCH', body: { name: 'Nope' } }],
      ['unitId', `/api/units/${fixtures.unitDenied._id}`, { method: 'GET' }],
      ['checklistId', `/api/checklists/${fixtures.checklistDenied._id}/notes`, { method: 'POST', body: { text: 'Nope' } }],
      ['messageId', `/api/chat/${fixtures.messageDenied._id}`, { method: 'DELETE' }]
    ];

    for (const [label, endpoint, options] of checks) {
      const res = await api(endpoint, { token: unassignedToken, ...options });
      assertNoBypass(res, label);
    }
  });

  await t.test('valid tenant token cannot access another tenant project by ID', async () => {
    const res = await api(`/api/projects/${fixtures.otherTenantProject._id}`, { token: adminToken });
    assertNoBypass(res, 'other tenant project');
  });

  await t.test('upload blocks dangerous extensions and allows valid PDF', async () => {
    const dangerous = new FormData();
    dangerous.set('projectId', String(fixtures.projectAllowed._id));
    dangerous.set('files', new Blob(['alert(1)'], { type: 'application/javascript' }), 'evil.js');
    const bad = await api('/api/documents/upload', {
      token: adminToken,
      method: 'POST',
      body: dangerous
    });
    assert.equal(bad.status, 400);

    const valid = new FormData();
    valid.set('projectId', String(fixtures.projectAllowed._id));
    valid.set('category', 'security-smoke');
    valid.set('files', new Blob(['%PDF-1.4 smoke'], { type: 'application/pdf' }), 'smoke.pdf');
    const ok = await api('/api/documents/upload', {
      token: adminToken,
      method: 'POST',
      body: valid
    });
    assert.equal(ok.status, 201, JSON.stringify(ok.payload));
    assert.equal(ok.payload[0].originalname, 'smoke.pdf');
    assert.equal(ok.payload[0].mimetype, 'application/pdf');
  });
});
