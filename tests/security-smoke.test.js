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
const Venta = require('../models/Venta');
const CommercialFolder = require('../models/CommercialFolder');
const { hashPassword } = require('../utils/passwords');

const ROOT = path.resolve(__dirname, '..');
const TENANT = 'security-smoke-tenant';
const OTHER_TENANT = 'security-smoke-other';
const OTHER_BANK_TENANT = 'security-smoke-other-bank';
const HIDDEN_PROJECT_TENANT = 'security-smoke-hidden-project';
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

  const bank = await User.create({
    tenantKey: TENANT,
    tenantKeys: [TENANT],
    name: 'Assigned Bank',
    email: 'assigned.bank@example.test',
    password: hashPassword(PASSWORD),
    role: 'bank',
    status: 'active'
  });

  const otherBank = await User.create({
    tenantKey: OTHER_BANK_TENANT,
    tenantKeys: [OTHER_BANK_TENANT],
    name: 'Other Bank',
    email: 'other.bank@example.test',
    password: hashPassword(PASSWORD),
    role: 'bank',
    status: 'active'
  });

  const otherBankAvaluator = await User.create({
    tenantKey: OTHER_BANK_TENANT,
    tenantKeys: [OTHER_BANK_TENANT],
    name: 'Other Bank Avaluator',
    email: 'other.bank.avaluator@example.test',
    password: hashPassword(PASSWORD),
    role: 'avaluador',
    roleRequested: null,
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
    publishStatus: 'approved',
    assignedBanks: [bank._id],
    assignees: { bank: [bank._id] }
  });

  const hiddenProject = await Project.create({
    tenantKey: HIDDEN_PROJECT_TENANT,
    name: 'Hidden Project',
    publishStatus: 'approved',
    assignedBanks: [otherBank._id]
  });

  const otherTenantUnits = await Unit.create([
    {
      tenantKey: OTHER_TENANT,
      projectId: otherTenantProject._id,
      manzana: 'A',
      lote: '1',
      code: 'A-1',
      modelo: 'Modelo actual',
      m2: 80,
      precioLista: 100000,
      price: 90000,
      estado: 'disponible',
      status: 'DISPONIBLE'
    },
    {
      tenantKey: OTHER_TENANT,
      projectId: otherTenantProject._id,
      manzana: 'A',
      lote: '2',
      code: 'A-2',
      modelo: 'Modelo vendido',
      m2: 95,
      precioLista: 250000,
      price: 200000,
      estado: 'con_cpp',
      status: 'DISPONIBLE'
    }
  ]);

  const otherTenantFolder = await CommercialFolder.create({
    tenantKey: OTHER_TENANT,
    projectId: otherTenantProject._id,
    name: 'Etapa bancaria',
    color: '#123456',
    order: 0
  });

  await Unit.updateMany(
    { _id: { $in: otherTenantUnits.map(unit => unit._id) } },
    { $set: { folderId: otherTenantFolder._id } }
  );

  const otherTenantVenta = await Venta.create({
    tenantKey: OTHER_TENANT,
    projectId: otherTenantProject._id,
    unitId: otherTenantUnits[1]._id,
    manzana: 'A',
    lote: '2',
    numCPP: 'CPP-TEST',
    valor: 250000,
    deletedAt: null
  });

  const otherTenantDocument = await Document.create({
    tenantKey: OTHER_TENANT,
    projectId: otherTenantProject._id,
    originalname: 'bank-visible.pdf',
    filename: 'bank-visible.pdf',
    path: 'uploads/bank-visible.pdf',
    mimetype: 'application/pdf',
    size: 10,
    status: 'ACTIVE'
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
    bank,
    otherBank,
    otherBankAvaluator,
    projectAllowed,
    projectDenied,
    otherTenantProject,
    hiddenProject,
    otherTenantUnits,
    otherTenantFolder,
    otherTenantVenta,
    otherTenantDocument,
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
  const bankToken = await login(fixtures.bank.email);
  const otherBankToken = await login(fixtures.otherBank.email, OTHER_BANK_TENANT);

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

  await t.test('avaluador cannot be selected in public registration', async () => {
    const res = await api('/api/auth/register', {
      method: 'POST',
      body: {
        name: 'Public Avaluator',
        email: 'public.avaluator@example.test',
        password: PASSWORD,
        roleRequested: 'avaluador'
      }
    });
    assert.equal(res.status, 400, JSON.stringify(res.payload));
  });

  let managedAvaluator;
  await t.test('bank creates, lists and activates only its own avaluators', async () => {
    const created = await api('/api/bank/avaluadores', {
      token: bankToken,
      method: 'POST',
      body: {
        name: 'Managed Avaluator',
        email: 'managed.avaluator@example.test',
        temporaryPassword: PASSWORD
      }
    });
    assert.equal(created.status, 201, JSON.stringify(created.payload));
    assert.equal(created.payload.user.role, 'avaluador');
    assert.equal(created.payload.user.status, 'pending');
    assert.equal(created.payload.user.tenantKey, TENANT);
    assert.equal('password' in created.payload.user, false);
    managedAvaluator = created.payload.user;

    const activated = await api(`/api/bank/avaluadores/${managedAvaluator._id}/status`, {
      token: bankToken,
      method: 'PATCH',
      body: { status: 'active', tenantKey: OTHER_BANK_TENANT }
    });
    assert.equal(activated.status, 200, JSON.stringify(activated.payload));
    assert.equal(activated.payload.user.status, 'active');
    assert.equal(activated.payload.user.tenantKey, TENANT);

    const list = await api('/api/bank/avaluadores', { token: bankToken });
    assert.equal(list.status, 200, JSON.stringify(list.payload));
    assert.ok(list.payload.users.some(user => String(user._id) === String(managedAvaluator._id)));
    assert.ok(list.payload.users.every(user => user.tenantKey === TENANT && user.role === 'avaluador'));
  });

  await t.test('bank cannot manage or assign an avaluator from another tenant', async () => {
    const blocked = await api(`/api/bank/avaluadores/${managedAvaluator._id}/status`, {
      token: otherBankToken,
      tenant: OTHER_BANK_TENANT,
      method: 'PATCH',
      body: { status: 'blocked' }
    });
    assert.equal(blocked.status, 404, JSON.stringify(blocked.payload));

    const wrongTenantAssignment = await api(
      `/api/bank/projects/${fixtures.otherTenantProject._id}/avaluadores/${fixtures.otherBankAvaluator._id}`,
      { token: bankToken, method: 'PUT' }
    );
    assert.equal(wrongTenantAssignment.status, 404, JSON.stringify(wrongTenantAssignment.payload));
    const assignments = await api(
      `/api/bank/projects/${fixtures.otherTenantProject._id}/avaluadores`,
      { token: bankToken }
    );
    assert.equal(assignments.status, 200, JSON.stringify(assignments.payload));
    assert.equal(assignments.payload.assignments.length, 0);
  });

  await t.test('bank assigns its avaluator to a visible cross-tenant project only', async () => {
    const assigned = await api(
      `/api/bank/projects/${fixtures.otherTenantProject._id}/avaluadores/${managedAvaluator._id}`,
      { token: bankToken, method: 'PUT' }
    );
    assert.equal(assigned.status, 200, JSON.stringify(assigned.payload));
    assert.equal(assigned.payload.assignment.bankTenantKey, TENANT);
    assert.equal(assigned.payload.assignment.projectTenantKey, OTHER_TENANT);
    assert.equal(assigned.payload.assignment.status, 'active');

    const hidden = await api(
      `/api/bank/projects/${fixtures.hiddenProject._id}/avaluadores/${managedAvaluator._id}`,
      { token: bankToken, method: 'PUT' }
    );
    assert.equal(hidden.status, 404, JSON.stringify(hidden.payload));

    const projectAssignments = await api(
      `/api/bank/projects/${fixtures.otherTenantProject._id}/avaluadores`,
      { token: bankToken }
    );
    assert.equal(projectAssignments.status, 200, JSON.stringify(projectAssignments.payload));
    assert.equal(projectAssignments.payload.bankTenantKey, TENANT);
    assert.equal(projectAssignments.payload.projectTenantKey, OTHER_TENANT);
    assert.equal(projectAssignments.payload.assignments.length, 1);
  });

  await t.test('revoked assignment is no longer active', async () => {
    const revoked = await api(
      `/api/bank/projects/${fixtures.otherTenantProject._id}/avaluadores/${managedAvaluator._id}`,
      { token: bankToken, method: 'DELETE' }
    );
    assert.equal(revoked.status, 200, JSON.stringify(revoked.payload));
    assert.equal(revoked.payload.assignment.status, 'revoked');
    assert.ok(revoked.payload.assignment.revokedAt);

    const assignments = await api(
      `/api/bank/projects/${fixtures.otherTenantProject._id}/avaluadores`,
      { token: bankToken }
    );
    assert.equal(assignments.status, 200, JSON.stringify(assignments.payload));
    assert.equal(assignments.payload.assignments.length, 0);
  });

  let avaluadorToken;
  await t.test('active avaluador can authenticate but cannot access existing backoffice APIs', async () => {
    avaluadorToken = await login(managedAvaluator.email);
    const me = await api('/api/auth/me', { token: avaluadorToken });
    assert.equal(me.status, 200, JSON.stringify(me.payload));
    assert.equal(me.payload.role, 'avaluador');

    const projects = await api('/api/projects', { token: avaluadorToken });
    assert.equal(projects.status, 403, JSON.stringify(projects.payload));
  });

  await t.test('mobile avaluador reads only an actively assigned cross-tenant project', async () => {
    const assigned = await api(
      `/api/bank/projects/${fixtures.otherTenantProject._id}/avaluadores/${managedAvaluator._id}`,
      { token: bankToken, method: 'PUT' }
    );
    assert.equal(assigned.status, 200, JSON.stringify(assigned.payload));

    const portfolio = await api('/api/mobile/v1/projects', { token: avaluadorToken });
    assert.equal(portfolio.status, 200, JSON.stringify(portfolio.payload));
    assert.equal(portfolio.payload.projects.length, 1);
    assert.equal(portfolio.payload.projects[0].id, String(fixtures.otherTenantProject._id));
    assert.equal('financialConditions' in portfolio.payload.projects[0], false);
    assert.equal('tenantKey' in portfolio.payload.projects[0], false);

    const detail = await api(
      `/api/mobile/v1/projects/${fixtures.otherTenantProject._id}`,
      { token: avaluadorToken }
    );
    assert.equal(detail.status, 200, JSON.stringify(detail.payload));
    assert.equal(detail.payload.project.id, String(fixtures.otherTenantProject._id));

    const units = await api(
      `/api/mobile/v1/projects/${fixtures.otherTenantProject._id}/units`,
      { token: avaluadorToken }
    );
    assert.equal(units.status, 200, JSON.stringify(units.payload));
    assert.equal(units.payload.units.length, 2);
    assert.equal('clienteId' in units.payload.units[0], false);
    assert.equal('precioLista' in units.payload.units[0], false);

    const unit = await api(
      `/api/mobile/v1/projects/${fixtures.otherTenantProject._id}/units/${fixtures.otherTenantUnits[0]._id}`,
      { token: avaluadorToken }
    );
    assert.equal(unit.status, 200, JSON.stringify(unit.payload));
    assert.equal(unit.payload.unit.id, String(fixtures.otherTenantUnits[0]._id));
  });

  await t.test('mobile project and unit IDs cannot bypass assignment boundaries', async () => {
    const otherBankAssignment = await api(
      `/api/bank/projects/${fixtures.hiddenProject._id}/avaluadores/${fixtures.otherBankAvaluator._id}`,
      { token: otherBankToken, tenant: OTHER_BANK_TENANT, method: 'PUT' }
    );
    assert.equal(otherBankAssignment.status, 200, JSON.stringify(otherBankAssignment.payload));

    const otherProject = await api(
      `/api/mobile/v1/projects/${fixtures.hiddenProject._id}`,
      { token: avaluadorToken }
    );
    assert.equal(otherProject.status, 404, JSON.stringify(otherProject.payload));

    const wrongUnit = await api(
      `/api/mobile/v1/projects/${fixtures.otherTenantProject._id}/units/${fixtures.unitDenied._id}`,
      { token: avaluadorToken }
    );
    assert.equal(wrongUnit.status, 404, JSON.stringify(wrongUnit.payload));

    const bankOnMobileApi = await api('/api/mobile/v1/projects', { token: bankToken });
    assert.equal(bankOnMobileApi.status, 403, JSON.stringify(bankOnMobileApi.payload));
  });

  let managedInspection;
  await t.test('avaluador creates and resumes a draft inspection on an assigned cross-tenant project', async () => {
    const protectedFields = await api(
      `/api/mobile/v1/projects/${fixtures.otherTenantProject._id}/inspections`,
      {
        token: avaluadorToken,
        method: 'POST',
        body: { status: 'draft', bankTenantKey: TENANT }
      }
    );
    assert.equal(protectedFields.status, 400, JSON.stringify(protectedFields.payload));

    const unassigned = await api(
      `/api/mobile/v1/projects/${fixtures.hiddenProject._id}/inspections`,
      { token: avaluadorToken, method: 'POST', body: { generalObservations: 'Denied' } }
    );
    assert.equal(unassigned.status, 404, JSON.stringify(unassigned.payload));

    const created = await api(
      `/api/mobile/v1/projects/${fixtures.otherTenantProject._id}/inspections`,
      {
        token: avaluadorToken,
        method: 'POST',
        body: { generalObservations: 'Initial draft' }
      }
    );
    assert.equal(created.status, 201, JSON.stringify(created.payload));
    assert.equal(created.payload.inspection.projectId, String(fixtures.otherTenantProject._id));
    assert.equal(created.payload.inspection.status, 'draft');
    assert.equal(created.payload.inspection.version, 0);
    assert.equal('bankTenantKey' in created.payload.inspection, false);
    assert.equal('avaluadorId' in created.payload.inspection, false);
    managedInspection = created.payload.inspection;

    const list = await api(
      `/api/mobile/v1/projects/${fixtures.otherTenantProject._id}/inspections`,
      { token: avaluadorToken }
    );
    assert.equal(list.status, 200, JSON.stringify(list.payload));
    assert.ok(list.payload.inspections.some(item => item.id === managedInspection.id));

    const detail = await api(`/api/mobile/v1/inspections/${managedInspection.id}`, {
      token: avaluadorToken
    });
    assert.equal(detail.status, 200, JSON.stringify(detail.payload));
    assert.equal(detail.payload.inspection.generalObservations, 'Initial draft');
  });

  await t.test('inspection draft uses optimistic versioning and rejects protected edits', async () => {
    const protectedEdit = await api(`/api/mobile/v1/inspections/${managedInspection.id}`, {
      token: avaluadorToken,
      method: 'PATCH',
      body: { version: 0, projectId: String(fixtures.hiddenProject._id) }
    });
    assert.equal(protectedEdit.status, 400, JSON.stringify(protectedEdit.payload));

    const updated = await api(`/api/mobile/v1/inspections/${managedInspection.id}`, {
      token: avaluadorToken,
      method: 'PATCH',
      body: { version: 0, generalObservations: 'Updated draft' }
    });
    assert.equal(updated.status, 200, JSON.stringify(updated.payload));
    assert.equal(updated.payload.inspection.version, 1);
    assert.equal(updated.payload.inspection.generalObservations, 'Updated draft');
    managedInspection = updated.payload.inspection;

    const stale = await api(`/api/mobile/v1/inspections/${managedInspection.id}`, {
      token: avaluadorToken,
      method: 'PATCH',
      body: { version: 0, generalObservations: 'Stale edit' }
    });
    assert.equal(stale.status, 409, JSON.stringify(stale.payload));
    assert.equal(stale.payload.error, 'version_conflict');
  });

  await t.test('unit progress is scoped to the inspection project and updated without duplicates', async () => {
    const unitId = fixtures.otherTenantUnits[0]._id;
    for (const progressPercent of [-0.1, 100.1]) {
      const invalid = await api(
        `/api/mobile/v1/inspections/${managedInspection.id}/units/${unitId}`,
        {
          token: avaluadorToken,
          method: 'PUT',
          body: { progressPercent }
        }
      );
      assert.equal(invalid.status, 400, JSON.stringify(invalid.payload));
    }

    const wrongProject = await api(
      `/api/mobile/v1/inspections/${managedInspection.id}/units/${fixtures.unitDenied._id}`,
      {
        token: avaluadorToken,
        method: 'PUT',
        body: { progressPercent: 10 }
      }
    );
    assert.equal(wrongProject.status, 404, JSON.stringify(wrongProject.payload));

    const created = await api(
      `/api/mobile/v1/inspections/${managedInspection.id}/units/${unitId}`,
      {
        token: avaluadorToken,
        method: 'PUT',
        body: { progressPercent: 42.5, observations: 'First observation' }
      }
    );
    assert.equal(created.status, 201, JSON.stringify(created.payload));
    assert.equal(created.payload.inspectionUnit.progressPercent, 42.5);
    assert.equal(created.payload.inspectionUnit.version, 0);
    assert.equal('bankTenantKey' in created.payload.inspectionUnit, false);

    const updated = await api(
      `/api/mobile/v1/inspections/${managedInspection.id}/units/${unitId}`,
      {
        token: avaluadorToken,
        method: 'PUT',
        body: { progressPercent: 50, observations: 'Second observation', version: 0 }
      }
    );
    assert.equal(updated.status, 200, JSON.stringify(updated.payload));
    assert.equal(updated.payload.inspectionUnit.version, 1);

    const list = await api(`/api/mobile/v1/inspections/${managedInspection.id}/units`, {
      token: avaluadorToken
    });
    assert.equal(list.status, 200, JSON.stringify(list.payload));
    assert.equal(list.payload.units.length, 1);
    assert.equal(list.payload.units[0].progressPercent, 50);

    const detail = await api(
      `/api/mobile/v1/inspections/${managedInspection.id}/units/${unitId}`,
      { token: avaluadorToken }
    );
    assert.equal(detail.status, 200, JSON.stringify(detail.payload));
    assert.equal(detail.payload.inspectionUnit.unitId, String(unitId));
  });

  await t.test('an avaluator from another bank cannot access an inspection by ID', async () => {
    const otherAvaluatorToken = await login(
      fixtures.otherBankAvaluator.email,
      OTHER_BANK_TENANT
    );
    const foreignRead = await api(`/api/mobile/v1/inspections/${managedInspection.id}`, {
      token: otherAvaluatorToken,
      tenant: OTHER_BANK_TENANT
    });
    assert.equal(foreignRead.status, 404, JSON.stringify(foreignRead.payload));

    const foreignEdit = await api(`/api/mobile/v1/inspections/${managedInspection.id}`, {
      token: otherAvaluatorToken,
      tenant: OTHER_BANK_TENANT,
      method: 'PATCH',
      body: { version: managedInspection.version, generalObservations: 'Foreign edit' }
    });
    assert.equal(foreignEdit.status, 404, JSON.stringify(foreignEdit.payload));
  });

  await t.test('bank methodology is tenant-scoped, versioned and frozen in a new inspection', async () => {
    const invalid = await api('/api/bank/avaluation-templates', {
      token: bankToken,
      method: 'POST',
      body: {
        name: 'Invalid weights',
        sections: [
          { key: 'estructura', name: 'Estructura', weight: 40, order: 1 },
          { key: 'acabados', name: 'Acabados', weight: 50, order: 2 }
        ]
      }
    });
    assert.equal(invalid.status, 400, JSON.stringify(invalid.payload));

    const created = await api('/api/bank/avaluation-templates', {
      token: bankToken,
      method: 'POST',
      body: {
        name: 'Security methodology',
        sections: [
          { key: 'estructura', name: 'Estructura', weight: 40, order: 1 },
          { key: 'acabados', name: 'Acabados', weight: 60, order: 2 }
        ]
      }
    });
    assert.equal(created.status, 201, JSON.stringify(created.payload));
    assert.equal(created.payload.template.version, 1);
    assert.equal(created.payload.template.status, 'draft');

    const crossBankRead = await api(
      `/api/bank/avaluation-templates/${created.payload.template.id}`,
      { token: otherBankToken, tenant: OTHER_BANK_TENANT }
    );
    assert.equal(crossBankRead.status, 404, JSON.stringify(crossBankRead.payload));

    const activated = await api(
      `/api/bank/avaluation-templates/${created.payload.template.id}/activate`,
      { token: bankToken, method: 'PATCH' }
    );
    assert.equal(activated.status, 200, JSON.stringify(activated.payload));
    assert.equal(activated.payload.template.status, 'active');

    const inspection = await api(
      `/api/mobile/v1/projects/${fixtures.otherTenantProject._id}/inspections`,
      { token: avaluadorToken, method: 'POST', body: { generalObservations: 'Structured' } }
    );
    assert.equal(inspection.status, 201, JSON.stringify(inspection.payload));
    assert.equal(inspection.payload.inspection.methodology.name, 'Security methodology');
    assert.equal(inspection.payload.inspection.methodology.version, 1);

    const unitId = fixtures.otherTenantUnits[1]._id;
    const forged = await api(
      `/api/mobile/v1/inspections/${inspection.payload.inspection.id}/units/${unitId}`,
      {
        token: avaluadorToken,
        method: 'PUT',
        body: {
          progressPercent: 99,
          progressSections: [{ key: 'estructura', progressPercent: 100 }]
        }
      }
    );
    assert.equal(forged.status, 400, JSON.stringify(forged.payload));

    const progress = await api(
      `/api/mobile/v1/inspections/${inspection.payload.inspection.id}/units/${unitId}`,
      {
        token: avaluadorToken,
        method: 'PUT',
        body: {
          progressSections: [
            { key: 'estructura', progressPercent: 100 },
            { key: 'acabados', progressPercent: 25 }
          ]
        }
      }
    );
    assert.equal(progress.status, 201, JSON.stringify(progress.payload));
    assert.equal(progress.payload.inspectionUnit.progressPercent, 55);
    assert.equal(progress.payload.inspectionUnit.progressSections[0].weight, 40);

    const versionTwo = await api('/api/bank/avaluation-templates', {
      token: bankToken,
      method: 'POST',
      body: {
        name: 'Security methodology revised',
        sections: [
          { key: 'estructura', name: 'Estructura revisada', weight: 20, order: 1 },
          { key: 'acabados', name: 'Acabados revisados', weight: 80, order: 2 }
        ]
      }
    });
    assert.equal(versionTwo.status, 201, JSON.stringify(versionTwo.payload));
    assert.equal(versionTwo.payload.template.version, 2);
    const activateVersionTwo = await api(
      `/api/bank/avaluation-templates/${versionTwo.payload.template.id}/activate`,
      { token: bankToken, method: 'PATCH' }
    );
    assert.equal(activateVersionTwo.status, 200, JSON.stringify(activateVersionTwo.payload));

    const unchanged = await api(
      `/api/mobile/v1/inspections/${inspection.payload.inspection.id}`,
      { token: avaluadorToken }
    );
    assert.equal(unchanged.status, 200, JSON.stringify(unchanged.payload));
    assert.equal(unchanged.payload.inspection.methodology.version, 1);
    assert.equal(unchanged.payload.inspection.methodology.sections[0].weight, 40);
  });

  await t.test('revoked mobile assignment disappears and freezes its draft', async () => {
    const revoked = await api(
      `/api/bank/projects/${fixtures.otherTenantProject._id}/avaluadores/${managedAvaluator._id}`,
      { token: bankToken, method: 'DELETE' }
    );
    assert.equal(revoked.status, 200, JSON.stringify(revoked.payload));

    const portfolio = await api('/api/mobile/v1/projects', { token: avaluadorToken });
    assert.equal(portfolio.status, 200, JSON.stringify(portfolio.payload));
    assert.deepEqual(portfolio.payload.projects, []);

    const project = await api(
      `/api/mobile/v1/projects/${fixtures.otherTenantProject._id}`,
      { token: avaluadorToken }
    );
    assert.equal(project.status, 404, JSON.stringify(project.payload));

    const create = await api(
      `/api/mobile/v1/projects/${fixtures.otherTenantProject._id}/inspections`,
      { token: avaluadorToken, method: 'POST', body: {} }
    );
    assert.equal(create.status, 404, JSON.stringify(create.payload));

    const edit = await api(`/api/mobile/v1/inspections/${managedInspection.id}`, {
      token: avaluadorToken,
      method: 'PATCH',
      body: { version: managedInspection.version, generalObservations: 'After revoke' }
    });
    assert.equal(edit.status, 404, JSON.stringify(edit.payload));

    const progress = await api(
      `/api/mobile/v1/inspections/${managedInspection.id}/units/${fixtures.otherTenantUnits[1]._id}`,
      {
        token: avaluadorToken,
        method: 'PUT',
        body: { progressPercent: 25 }
      }
    );
    assert.equal(progress.status, 404, JSON.stringify(progress.payload));
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

  await t.test('assigned bank reads the complete canonical commercial data across tenants', async () => {
    const projectId = fixtures.otherTenantProject._id;
    const unitId = fixtures.otherTenantUnits[1]._id;
    const requests = await Promise.all([
      api(`/api/projects/${projectId}/summary`, { token: bankToken }),
      api(`/api/units?projectId=${projectId}`, { token: bankToken }),
      api(`/api/ventas?projectId=${projectId}`, { token: bankToken }),
      api(`/api/commercial-folders?projectId=${projectId}`, { token: bankToken }),
      api(`/api/documents?projectId=${projectId}`, { token: bankToken }),
      api(`/api/units/${unitId}`, { token: bankToken }),
      api(`/api/ventas/by-unit/${unitId}`, { token: bankToken })
    ]);

    for (const response of requests) {
      assert.equal(response.status, 200, JSON.stringify(response.payload));
    }

    const [summary, units, ventas, folders, documents, unit, venta] = requests.map(item => item.payload);
    assert.equal(summary.kpis.inventoryValue, 350000);
    assert.equal(units.length, 2);
    assert.equal(units[1].estado, 'con_cpp');
    assert.equal(units[1].precioLista, 250000);
    assert.equal(units[1].m2, 95);
    assert.equal(String(units[1].folderId), String(fixtures.otherTenantFolder._id));
    assert.equal(ventas.length, 1);
    assert.equal(folders.folders.length, 1);
    assert.equal(documents.length, 1);
    assert.equal(documents[0].originalname, 'bank-visible.pdf');
    assert.equal(unit.estado, 'con_cpp');
    assert.equal(venta.numCPP, 'CPP-TEST');
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
