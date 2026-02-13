// routes/process.js
const express = require('express');
const router = express.Router();
router.use((req, _res, next) => {
  console.log('[TRACE process.js]', req.method, req.originalUrl);
  next();
});
const mongoose = require('mongoose');

const ProcessTemplate = require('../models/ProcessTemplate');
const ProjectChecklist = require('../models/ProjectChecklist');

// ===== Helpers generales =====
const DELETE_PIN = process.env.PROCESS_DELETE_PIN || '2580';

function requirePin(req, res) {
  const pin = String(req.body?.pin || req.query?.pin || '');
  if (pin !== DELETE_PIN) {
    return res.status(403).json({ error: 'PIN inválido' });
  }
  return null;
}
function userName(req) {
  return (req.user?.name || req.user?.email || 'usuario');
}
function norm(s) { return (s || '').toString().toLowerCase(); }

// Roles de comportamiento
const FULL_ACCESS_ROLES = [
  'admin', 'bank', 'promoter', 'gerencia', 'socios', 'financiero', 'contable'
];
const LIMITED_ROLES = ['legal', 'tecnico', 'commercial'];

function isFullAccess(role) { return FULL_ACCESS_ROLES.includes(norm(role)); }
function isLimited(role) { return LIMITED_ROLES.includes(norm(role)); }

// Construye query de visibilidad de checklists según el rol del usuario
function buildChecklistVisibilityQuery(req, base = {}) {
  const role = norm(req.user?.role);

  if (isFullAccess(role)) {
    return base; // ve todo dentro del proyecto
  }
  if (isLimited(role)) {
    return {
      ...base,
      $or: [
        { roleOwner: role },
        { visibleToRoles: role },
        // tolerancia si aún hay docs sin migrar
        { visibleToRoles: { $exists: false } },
        { visibleToRoles: { $size: 0 } }
      ]
    };
  }
  // otros roles no deberían ver nada aquí
  return { ...base, _id: { $exists: false } };
}

// DEBUG SOLO PARA TI (borralo luego)
router.get('/process/debug-templates', async (req, res) => {
  const dbName = mongoose.connection?.db?.databaseName;
  const col = mongoose.connection?.db?.collection('processTemplates');
  const count = col ? await col.countDocuments({}) : -1;
  const activeCount = col ? await col.countDocuments({ active: true }) : -1;
  const active = col ? await col.findOne({ active: true }, { projection: { version: 1, active: 1 } }) : null;
  res.json({ ok: true, dbName, count, activeCount, active });
});

/* =========================================================================
   PLANTILLAS
   ========================================================================= */

// GET /api/process/templates/active
router.get('/process/templates/active', async (req, res) => {
  const tpl = await ProcessTemplate.findOne({ active: true }).lean();
  if (!tpl) return res.status(404).json({ error: 'No hay plantilla activa' });
  res.json(tpl);
});

// (Opcional admin) activar plantilla por versión
router.post('/process/templates/:version/activate', async (req, res) => {
  const { version } = req.params;
  await ProcessTemplate.updateMany({}, { $set: { active: false } });
  const tpl = await ProcessTemplate.findOneAndUpdate(
    { version: Number(version) },
    { $set: { active: true } },
    { new: true }
  );
  if (!tpl) return res.status(404).json({ error: 'Versión no encontrada' });
  res.json({ ok: true, template: tpl });
});

/* =========================================================================
   INSTANCIAR PLANTILLA EN UN PROYECTO
   ========================================================================= */

// POST /api/projects/:projectId/process/apply-template?version=1
// POST /api/projects/:projectId/process/apply-template?version=1
router.post('/:projectId/process/apply-template', async (req, res) => {
  const { projectId } = req.params;
  const version = req.query.version ? Number(req.query.version) : null;

  // ✅ 1) Validar ObjectId
  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    return res.status(400).json({ error: 'projectId inválido' });
  }
  const projectIdObj = new mongoose.Types.ObjectId(projectId);

  // ✅ 2) Cargar plantilla
  const tpl = version
    ? await ProcessTemplate.findOne({ version }).lean()
    : await ProcessTemplate.findOne({ active: true }).lean();

  if (!tpl) return res.status(404).json({ error: 'Plantilla no disponible' });

  // ✅ 3) Evitar duplicados (IMPORTANTE: usa ObjectId)
  const existing = await ProjectChecklist
    .find({ projectId: projectIdObj })
    .select('templateKey')
    .lean();

  const existingKeys = new Set(existing.map(e => e.templateKey).filter(Boolean));

  const toInsert = [];
  for (const step of (tpl.steps || [])) {
    if (existingKeys.has(step.key)) continue;

    const roleOwner = step.role ? norm(step.role) : 'tecnico';
    const visibleToRoles = Array.isArray(step.visibleToRoles)
      ? step.visibleToRoles.map(r => norm(r))
      : [];

    toInsert.push({
      projectId: projectIdObj,               // ✅ ObjectId real
      templateKey: step.key,
      title: step.title,
      phase: step.phase,
      level: step.level,
      orderInLevel: step.orderInLevel || 0,
      role: step.role,
      roleOwner,
      visibleToRoles,
      prerequisitesKeys: step.prerequisites || [],
      status: 'PENDIENTE',
      createdBy: userName(req),
      subtasks: (step.type === 'GROUP' && Array.isArray(step.subtasksTemplate))
        ? step.subtasksTemplate.map(st => ({ title: st.title }))
        : []
    });
  }

  if (toInsert.length) await ProjectChecklist.insertMany(toInsert);
  res.json({ ok: true, created: toInsert.length });
});

/* =========================================================================
   CHECKLISTS DEL PROYECTO
   ========================================================================= */

// GET /api/projects/:projectId/checklists
router.get('/projects/:projectId/checklists', async (req, res) => {
  const { projectId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    return res.status(400).json({ error: 'projectId inválido' });
  }
  const projectIdObj = new mongoose.Types.ObjectId(projectId);

  const base = { projectId: projectIdObj };

  const q = buildChecklistVisibilityQuery(req, base);

  const list = await ProjectChecklist
    .find(q)
    .sort({ phase: 1, level: 1, orderInLevel: 1, createdAt: 1 })
    .lean();

  res.json({ checklists: list });
});

// POST /api/projects/:projectId/checklists (ad-hoc)
// acepta roleOwner y visibleToRoles; mantiene "role" legacy para compat
router.post('/projects/:projectId/checklists', async (req, res) => {
  const { projectId } = req.params;
  const {
    title,
    phase,
    role,                 // legacy
    roleOwner,            // nuevo
    visibleToRoles,       // nuevo
    level,
    orderInLevel,
    dueDate
  } = req.body || {};

  const owner = roleOwner ? norm(roleOwner) : (role ? norm(role) : 'tecnico');
  const acl = Array.isArray(visibleToRoles)
    ? visibleToRoles.map(norm)
    : (typeof visibleToRoles === 'string' && visibleToRoles.trim().length
        ? visibleToRoles.split(',').map(s => norm(s.trim()))
        : []);

  const doc = await ProjectChecklist.create({
    projectId,
    title,
    phase,
    role, // legacy (solo informativo)
    roleOwner: owner,
    visibleToRoles: acl,
    level: Number(level ?? 1),
    orderInLevel: Number(orderInLevel ?? 0),
    dueDate: dueDate || null,
    createdBy: userName(req)
  });

  res.json(doc);
});

// PUT /api/checklists/:id
router.put('/checklists/:id', async (req, res) => {
  const { id } = req.params;
  const patch = { ...req.body, updatedBy: userName(req) };

  // Normaliza si el front envía roleOwner / visibleToRoles como strings
  if (typeof patch.roleOwner === 'string') patch.roleOwner = norm(patch.roleOwner);
  if (Array.isArray(patch.visibleToRoles)) {
    patch.visibleToRoles = patch.visibleToRoles.map(norm);
  } else if (typeof patch.visibleToRoles === 'string') {
    patch.visibleToRoles = patch.visibleToRoles.split(',').map(s => norm(s.trim()));
  }

  const cl = await ProjectChecklist.findByIdAndUpdate(id, patch, { new: true });
  if (!cl) return res.status(404).json({ error: 'Checklist no encontrado' });
  res.json(cl);
});

// DELETE /api/checklists/:id (PIN)
router.delete('/checklists/:id', async (req, res) => {
  const pinErr = requirePin(req, res); if (pinErr) return;
  const { id } = req.params;
  const cl = await ProjectChecklist.findByIdAndDelete(id);
  if (!cl) return res.status(404).json({ error: 'Checklist no encontrado' });
  res.json({ ok: true });
});

/* =========================================================================
   COMPLETAR / VALIDAR / NOTAS
   ========================================================================= */

// helper: ¿está activo un checklist?
async function isActiveChecklist(cl) {
  // Regla 1: todos los checklists del nivel anterior (misma fase) deben estar COMPLETADO
  const prevLevel = cl.level - 1;
  if (prevLevel >= 1) {
    const prev = await ProjectChecklist.find({
      projectId: cl.projectId,
      phase: cl.phase,
      level: prevLevel
    }).select('status').lean();

    if (prev.length && prev.some(x => x.status !== 'COMPLETADO')) return false;
  }
  // Regla 2: prerrequisitos explícitos (por templateKey) deben estar COMPLETADO
  if (cl.prerequisitesKeys?.length) {
    const prereq = await ProjectChecklist.find({
      projectId: cl.projectId,
      templateKey: { $in: cl.prerequisitesKeys }
    }).select('status').lean();
    if (prereq.some(x => x.status !== 'COMPLETADO')) return false;
  }
  return true;
}

// POST /api/checklists/:id/complete  { force?: boolean }
router.post('/checklists/:id/complete', async (req, res) => {
  const { id } = req.params;
  const { force } = req.body || {};
  const cl = await ProjectChecklist.findById(id);
  if (!cl) return res.status(404).json({ error: 'Checklist no encontrado' });

  const active = await isActiveChecklist(cl);
  if (!active && !force) {
    return res.status(409).json({ error: 'Checklist bloqueado por secuencia', code: 'BLOCKED' });
  }

  cl.status = 'COMPLETADO';
  cl.completedBy = userName(req);
  cl.completedAt = new Date();
  if (!active && force) cl.outOfOrderCompletion = true;
  await cl.save();

  res.json({ ok: true, checklist: cl });
});

// POST /api/checklists/:id/validate  { validated:true/false }
router.post('/checklists/:id/validate', async (req, res) => {
  const { id } = req.params;
  const { validated } = req.body;
  const cl = await ProjectChecklist.findByIdAndUpdate(
    id,
    {
      validated: !!validated,
      validatedBy: userName(req),
      validatedAt: validated ? new Date() : null
    },
    { new: true }
  );
  if (!cl) return res.status(404).json({ error: 'Checklist no encontrado' });
  res.json({ ok: true, checklist: cl });
});

// POST /api/checklists/:id/notes  { text }
router.post('/checklists/:id/notes', async (req, res) => {
  const { id } = req.params;
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'Texto requerido' });
  const cl = await ProjectChecklist.findById(id);
  if (!cl) return res.status(404).json({ error: 'Checklist no encontrado' });
  cl.notes.push({ text, author: userName(req), userId: req.user?._id });
  await cl.save();
  res.json({ ok: true });
});

/* =========================================================================
   SUBTAREAS
   ========================================================================= */

// POST /api/checklists/:id/subtasks  { title }
router.post('/checklists/:id/subtasks', async (req, res) => {
  const { id } = req.params;
  const { title } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Título requerido' });
  const cl = await ProjectChecklist.findById(id);
  if (!cl) return res.status(404).json({ error: 'Checklist no encontrado' });
  cl.subtasks.push({ title });
  await cl.save();
  res.json({ ok: true, checklist: cl });
});

// PUT /api/checklists/:id/subtasks/:sid  { completed?, title?, dueDate? }
router.put('/checklists/:id/subtasks/:sid', async (req, res) => {
  const { id, sid } = req.params;
  const cl = await ProjectChecklist.findById(id);
  if (!cl) return res.status(404).json({ error: 'Checklist no encontrado' });
  const st = cl.subtasks.id(sid);
  if (!st) return res.status(404).json({ error: 'Subtarea no encontrada' });
  if (typeof req.body.completed === 'boolean') st.completed = req.body.completed;
  if (typeof req.body.title === 'string') st.title = req.body.title;
  if (req.body.dueDate) st.dueDate = req.body.dueDate;
  await cl.save();
  res.json({ ok: true });
});

/* =========================================================================
   Migración desde colección legacy "checklists" a ProjectChecklist
   ========================================================================= */

const LegacyChecklistModel = mongoose.model(
  'LegacyChecklist',
  new mongoose.Schema({
    projectId: mongoose.Schema.Types.ObjectId,
    project:   mongoose.Schema.Types.ObjectId,
    key: String,
    title: String,
    phase: String,
    role: String,
    level: Number,
    orderInLevel: Number,
    order: Number,
    type: String,
    subtasksTemplate: [{ title: String }],
    status: String,
    validated: Boolean,
    dueDate: Date,
    archived: Boolean,
    deleted: Boolean,
    hidden: Boolean,
    lockedBySequence: Boolean,
    meta: Object
  }, { collection: 'checklists', versionKey: false })
);

// Normaliza un doc legacy -> shape de ProjectChecklist
function normalizeLegacyToProjectChecklist(lc, projectId) {
  const status =
    lc.status === 'COMPLETADO' || lc.status === 'DONE' ? 'COMPLETADO' :
    lc.status === 'EN_PROCESO' || lc.status === 'IN_PROGRESS' ? 'EN_PROCESO' :
    'PENDIENTE';

  const owner = lc.role ? norm(lc.role) : 'tecnico';

  return {
    projectId,
    templateKey: lc.key || undefined,
    title: lc.title || 'Checklist',
    phase: lc.phase || 'PREESTUDIOS',
    level: Number(lc.level ?? lc.order ?? 0) || 0,
    orderInLevel: Number(lc.orderInLevel ?? lc.order ?? lc.level ?? 0) || 0,

    // legacy informativo
    role: lc.role || 'TECNICO',

    // nuevos campos ACL
    roleOwner: owner,
    visibleToRoles: [],

    prerequisitesKeys: [],
    status,
    createdBy: 'migrator',
    subtasks: Array.isArray(lc.subtasksTemplate)
      ? lc.subtasksTemplate.map(st => ({ title: st.title }))
      : []
  };
}

// POST /api/projects/:projectId/checklists/migrate-legacy
router.post('/projects/:projectId/checklists/migrate-legacy', async (req, res) => {
  const { projectId } = req.params;

  // 1) Traer todos los legacy de ese proyecto
  const legacy = await LegacyChecklistModel.find({
    $or: [
      { projectId: new mongoose.Types.ObjectId(projectId) },
      { project:   new mongoose.Types.ObjectId(projectId) },
      { projectId: projectId }, // por si quedaron como string
      { project:   projectId }
    ],
    archived: { $ne: true }, deleted: { $ne: true }
  }).lean();

  if (!legacy.length) return res.json({ ok: true, migrated: 0, skipped: 0 });

  // 2) Evitar duplicados por (templateKey|title)
  const existing = await ProjectChecklist
    .find({ projectId }, { templateKey: 1, title: 1 }).lean();
  const existingKeys = new Set(
    existing.map(x => (x.templateKey || '') + '|' + (x.title || ''))
  );

  // 3) Preparar inserciones
  const toInsert = [];
  for (const lc of legacy) {
    const sig = (lc.key || '') + '|' + (lc.title || '');
    if (existingKeys.has(sig)) continue;
    toInsert.push(normalizeLegacyToProjectChecklist(lc, projectId));
  }

  // 4) Insertar en ProjectChecklist
  if (toInsert.length) await ProjectChecklist.insertMany(toInsert);

  res.json({ ok: true, migrated: toInsert.length, skipped: legacy.length - toInsert.length });
});

module.exports = router;
