// seed.js
// ROLE-SEP: seed actualizado a los nuevos roles ('admin','bank','promoter','commercial')
// y estados de usuario (status: 'active' | 'pending').

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const Tenant = require('./models/Tenant');
const User = require('./models/User');
const Project = require('./models/Project');
const Milestone = require('./models/Milestone');
const Document = require('./models/Document');
const Loan = require('./models/Loan');
const Budget = require('./models/Budget');
const Unit = require('./models/Unit');

const { MONGO_URI } = process.env;

async function run() {
  await mongoose.connect(MONGO_URI, {});
  console.log('[Seed] Conectado a Mongo');

  const tenantKey = 'bancodemo';

  // Tenant
  let t = await Tenant.findOne({ tenantKey });
  if (!t) {
    t = await Tenant.create({
      tenantKey,
      name: 'Banco Demo',
      baseDomain: process.env.BASE_DOMAIN || 'localhost'
    });
    console.log('[Seed] Tenant creado');
  }

  // ===== Usuarios (password en claro para demo) =====
  // ROLE-SEP: limpiamos este tenant para dejar datos consistentes
  await User.deleteMany({ tenantKey });

  // ADMIN ACTIVO  // ROLE-SEP
  const admin = await User.create({
    tenantKey,
    name: 'Administrador',
    email: 'admin@trustforbanks.local',
    password: process.env.ADMIN_PASSWORD || 'admin123', // DEMO: sin hash
    role: 'admin',      // ROLE-SEP (minúsculas)
    status: 'active'    // ROLE-SEP (activo para poder entrar)
  });

  // BANK ACTIVO  // ROLE-SEP
  const bank = await User.create({
    tenantKey,
    name: 'Banco Ejecutivo',
    email: 'bank@trustforbanks.local',
    password: 'secret',
    role: 'bank',
    status: 'active'
  });

  // PROMOTER y COMMERCIAL en pending (para probar flujos de aprobación)  // ROLE-SEP
  const promoterPending = await User.create({
    tenantKey,
    name: 'Promotor Demo',
    email: 'promoter@trustforbanks.local',
    password: 'secret',
    role: 'bank',                // ROLE-SEP: el campo role real no se usa hasta aprobar (queda bank por compat)
    roleRequested: 'promoter',   // ROLE-SEP
    status: 'pending'            // ROLE-SEP
  });

  const commercialPending = await User.create({
    tenantKey,
    name: 'Comercial Demo',
    email: 'commercial@trustforbanks.local',
    password: 'secret',
    role: 'bank',                // ROLE-SEP: ver comentario anterior
    roleRequested: 'commercial', // ROLE-SEP
    status: 'pending'            // ROLE-SEP
  });

  console.log('[Seed] Usuarios creados:', {
    admin: admin.email,
    bank: bank.email,
    promoterPending: promoterPending.email,
    commercialPending: commercialPending.email
  });

  // ===== Proyecto con KPIs =====
  await Project.deleteMany({ tenantKey });
  const project = await Project.create({
    tenantKey,
    name: 'Residencial Las Flores',
    description: 'Conjunto residencial de 50 unidades.',
    // ROLE-SEP: mantenemos tus estados operativos legacy
    status: 'EN_CURSO',
    loanApproved: 1000000,
    loanDisbursed: 250000,
    loanBalance: 750000,
    budgetApproved: 800000,
    budgetSpent: 120000,
    unitsTotal: 50,
    unitsSold: 12
    // Si añadiste campos de asignación/publicación, puedes incluirlos aquí:
    // assignedPromoters: [promoterPending._id],
    // assignedCommercials: [commercialPending._id],
    // pubStatus: 'approved'  // o el nombre que hayas usado para publicación
  });
  console.log('[Seed] Proyecto creado:', project.name);

  // ===== Budget =====
  await Budget.deleteMany({ tenantKey, projectId: project._id });
  await Budget.create({
    tenantKey, projectId: project._id,
    amountApproved: 800000, spent: 120000
  });

  // ===== Loan =====
  await Loan.deleteMany({ tenantKey, projectId: project._id });
  await Loan.create({
    tenantKey, projectId: project._id,
    amountApproved: 1000000,
    disbursements: [{ date: new Date(), amount: 250000 }]
  });

  // ===== Milestones =====
  await Milestone.deleteMany({ tenantKey, projectId: project._id });
  await Milestone.insertMany([
    { tenantKey, projectId: project._id, name: 'Permisos', progress: 100, status: 'COMPLETADO', dueDate: new Date() },
    { tenantKey, projectId: project._id, name: 'Cimentación', progress: 40, status: 'EN_PROCESO', dueDate: new Date(Date.now() + 20*24*60*60*1000) }
  ]);

  // ===== Units =====
  await Unit.deleteMany({ tenantKey, projectId: project._id });
  const units = Array.from({ length: 50 }).map((_, i) => ({
    tenantKey,
    projectId: project._id,
    code: `UF-${i + 1}`,
    status: i < 12 ? 'VENDIDA' : 'DISPONIBLE',
    price: 120000 + (i * 1000)
  }));
  await Unit.insertMany(units);

  // ===== Documentos (crear placeholder en uploads/) =====
  const uploadsDir = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
  const placeholder = path.join(uploadsDir, 'seed-placeholder.txt');
  fs.writeFileSync(placeholder, 'Documento de ejemplo (seed)\n');

  await Document.deleteMany({ tenantKey, projectId: project._id });
  await Document.insertMany([
    {
      tenantKey,
      projectId: project._id,
      originalname: 'contrato-promesa.pdf',
      filename: 'seed-placeholder.txt',
      path: 'uploads/seed-placeholder.txt',
      mimetype: 'text/plain',
      size: 30,
      expiryDate: new Date(Date.now() + 15 * 24 * 60 * 60 * 1000), // < 30 días
      uploadedBy: promoterPending._id
    },
    {
      tenantKey,
      projectId: project._id,
      originalname: 'licencia-construccion.pdf',
      filename: 'seed-placeholder.txt',
      path: 'uploads/seed-placeholder.txt',
      mimetype: 'text/plain',
      size: 30,
      expiryDate: new Date(Date.now() + 120 * 24 * 60 * 60 * 1000),
      uploadedBy: admin._id
    },
    {
      tenantKey,
      projectId: project._id,
      originalname: 'poliza-seguro.pdf',
      filename: 'seed-placeholder.txt',
      path: 'uploads/seed-placeholder.txt',
      mimetype: 'text/plain',
      size: 30,
      expiryDate: null,
      uploadedBy: admin._id
    }
  ]);

  console.log('[Seed] Datos de ejemplo listos');
  await mongoose.disconnect();
  console.log('[Seed] Desconectado. OK');
}

run().catch(e => {
  console.error('[Seed] Error:', e);
  process.exit(1);
});
