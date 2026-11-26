// routes/process.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const ProjectChecklist = require('../models/ProjectChecklist');
const Project = require('../models/Project');
const Unit = require('../models/Unit');
const UnitChecklistProgress = require('../models/UnitChecklistProgress');
const ProjectWorkPackage = require('../models/ProjectWorkPackage');
const { requireRole, requireProjectAccess } = require('../middleware/rbac');
const bankReadOnly = require('../middleware/bankReadOnly');
const { isFullAccessRole, isLimitedAreaRole } = require('../utils/roles');

router.use(bankReadOnly);

// ===== Helpers generales =====
function requirePin(req, res) {
  if (!req.deletePinVerified) {
    return res.status(403).json({ error: 'PIN inválido' });
  }
  return null;
}
function userName(req) {
  return (req.user?.name || req.user?.email || 'usuario');
}
function norm(s) { return (s || '').toString().toLowerCase(); }

function getTenantKey(req) {
  return req.tenantKey || req.user?.tenantKey || req.tenant?.tenantKey || req.tenant?.key || null;
}

function legacyTenantQuery(tenantKey) {
  return {
    $or: [
      { tenantKey },
      { tenantKey: { $exists: false } },
      { tenantKey: null },
      { tenantKey: '' }
    ]
  };
}

async function loadTenantProject(req, res, projectId = req.params.projectId) {
  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    res.status(400).json({ error: 'projectId invalido' });
    return null;
  }
  const tenantKey = getTenantKey(req);
  if (!tenantKey) {
    res.status(403).json({ error: 'Falta tenantKey' });
    return null;
  }
  const project = await Project.findOne({ _id: projectId, tenantKey }).lean();
  if (!project) {
    res.status(404).json({ error: 'Proyecto no encontrado' });
    return null;
  }
  return project;
}

async function loadTenantChecklist(req, res, id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ error: 'checklistId invalido' });
    return null;
  }
  const tenantKey = getTenantKey(req);
  if (!tenantKey) {
    res.status(403).json({ error: 'Falta tenantKey' });
    return null;
  }

  let cl = await ProjectChecklist.findOne({ _id: id, tenantKey });
  if (cl) return cl;

  cl = await ProjectChecklist.findOne({
    _id: id,
    $or: [{ tenantKey: { $exists: false } }, { tenantKey: null }, { tenantKey: '' }]
  });
  if (!cl) {
    res.status(404).json({ error: 'Checklist no encontrado' });
    return null;
  }

  const project = await Project.findOne({ _id: cl.projectId, tenantKey }).select('_id').lean();
  if (!project) {
    res.status(404).json({ error: 'Checklist no encontrado' });
    return null;
  }

  cl.tenantKey = tenantKey;
  await cl.save();
  return cl;
}

async function attachProjectFromChecklist(req, res, next) {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: 'checklistId invalido' });
    }

    const tenantKey = getTenantKey(req);
    if (!tenantKey) return res.status(403).json({ error: 'Falta tenantKey' });

    const cl = await ProjectChecklist.findOne({
      _id: id,
      ...legacyTenantQuery(tenantKey)
    }).select('projectId').lean();
    if (!cl) return res.status(404).json({ error: 'Checklist no encontrado' });

    const project = await Project.findOne({ _id: cl.projectId, tenantKey }).lean();
    if (!project) return res.status(404).json({ error: 'Checklist no encontrado' });

    req.project = project;
    next();
  } catch (e) {
    next(e);
  }
}

async function attachProjectFromWorkPackage(req, res, next) {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ error: 'Paquete inválido.' });
    }
    const tenantKey = getTenantKey(req);
    if (!tenantKey) return res.status(403).json({ error: 'Falta tenantKey' });
    const workPackage = await ProjectWorkPackage.findOne({ _id: req.params.id, tenantKey });
    if (!workPackage) return res.status(404).json({ error: 'Paquete no encontrado.' });
    const project = await Project.findOne({ _id: workPackage.projectId, tenantKey }).lean();
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado.' });
    req.workPackage = workPackage;
    req.project = project;
    next();
  } catch (error) { next(error); }
}

function isFullAccess(role) { return isFullAccessRole(role); }
function isLimited(role) { return isLimitedAreaRole(role); }

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

router.get('/process/debug-templates', requireRole('admin', 'superadmin'), async (req, res) => {
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
  const col = mongoose.connection.db.collection('processTemplates');
  const tpl = await col.findOne({ active: true });
  if (!tpl) return res.status(404).json({ error: 'No hay plantilla activa' });
  res.json(tpl);
});


// (Opcional admin) activar plantilla por versión
router.post('/process/templates/:version/activate', requireRole('admin', 'superadmin'), async (req, res) => {
  const { version } = req.params;
  const col = mongoose.connection.db.collection('processTemplates');

  await col.updateMany({ active: true }, { $set: { active: false } });
  const r = await col.findOneAndUpdate(
    { version: Number(version) },
    { $set: { active: true } },
    { returnDocument: 'after' } // driver nativo
  );

  const tpl = r && (r.value || r);
  if (!tpl) return res.status(404).json({ error: 'Versión no encontrada' });

  res.json({ ok: true, template: { _id: tpl._id, version: tpl.version, active: tpl.active } });
});

/* =========================================================================
   INSTANCIAR PLANTILLA EN UN PROYECTO
   ========================================================================= */

// POST /api/projects/:projectId/process/apply-template?version=1
// POST /api/projects/:projectId/process/apply-template?version=1
router.post('/projects/:projectId/process/apply-template', requireProjectAccess({ commercialOnlySales: false }), async (req, res) => {
  const { projectId } = req.params;
  const version = req.query.version ? Number(req.query.version) : null;
  const project = await loadTenantProject(req, res, projectId);
  if (!project) return;

  // ✅ 1) Validar ObjectId
  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    return res.status(400).json({ error: 'projectId inválido' });
  }
  const projectIdObj = new mongoose.Types.ObjectId(projectId);

  // ✅ 2) Cargar plantilla
  // ✅ Cargar plantilla SIN depender del Model (evita líos de collection/model)
const col = mongoose.connection.db.collection('processTemplates');

const tpl = version
  ? await col.findOne({ version: Number(version) })
  : await col.findOne({ active: true });

if (!tpl) {
  const dbg = {
    db: mongoose.connection.db.databaseName,
    col: 'processTemplates',
    count: await col.countDocuments({}),
    activeCount: await col.countDocuments({ active: true }),
    want: version ? { version: Number(version) } : { active: true }
  };
  return res.status(404).json({ error: 'Plantilla no disponible', dbg });
}



const existing = await ProjectChecklist
  .find({ projectId: projectIdObj, ...legacyTenantQuery(project.tenantKey) }, { templateKey: 1, title: 1 }).lean();


  const existingKeys = new Set(existing.map(e => e.templateKey).filter(Boolean));

  const toInsert = [];
  for (const step of (tpl.steps || [])) {
    if (existingKeys.has(step.key)) continue;

    const roleOwner = step.role ? norm(step.role) : 'tecnico';
    const visibleToRoles = Array.isArray(step.visibleToRoles)
      ? step.visibleToRoles.map(r => norm(r))
      : [];

    toInsert.push({
      tenantKey: project.tenantKey,
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
router.get('/projects/:projectId/checklists', requireProjectAccess({ commercialOnlySales: false }), async (req, res) => {
  const { projectId } = req.params;
  const project = await loadTenantProject(req, res, projectId);
  if (!project) return;

  if (!mongoose.Types.ObjectId.isValid(projectId)) {
    return res.status(400).json({ error: 'projectId inválido' });
  }
  const projectIdObj = new mongoose.Types.ObjectId(projectId);

  const base = { projectId: projectIdObj, ...legacyTenantQuery(project.tenantKey) };

  const q = buildChecklistVisibilityQuery(req, base);

  const list = await ProjectChecklist
    .find(q)
    .sort({ phase: 1, level: 1, orderInLevel: 1, createdAt: 1 })
    .lean();

  res.json({ checklists: list });
});

// Progreso por unidad de los checklists repetitivos. La definición de la
// actividad sigue viviendo en ProjectChecklist; aquí sólo se guarda su estado
// para cada unidad, evitando copiar títulos o crear una segunda agenda.
router.get('/projects/:projectId/unit-checklist-progress', requireProjectAccess({ commercialOnlySales: false }), async (req, res) => {
  const project = await loadTenantProject(req, res, req.params.projectId);
  if (!project) return;
  const visible = await ProjectChecklist.find(buildChecklistVisibilityQuery(req, {
    projectId: project._id,
    ...legacyTenantQuery(project.tenantKey),
    phase: { $in: ['CONTRATISTAS', 'OBRA'] }
  })).select('_id').lean();
  const checklistIds = visible.map(item => item._id);
  const rows = checklistIds.length
    ? await UnitChecklistProgress.find({ tenantKey: project.tenantKey, projectId: project._id, checklistId: { $in: checklistIds } }).lean()
    : [];
  res.json({ progress: rows });
});

// Paquetes compartidos entre Contratistas y Obra. El rango, el contratista y
// el progreso se guardan una sola vez y ambas fases leen este mismo registro.
router.get('/projects/:projectId/work-packages', requireProjectAccess({ commercialOnlySales: false }), async (req, res) => {
  const project = await loadTenantProject(req, res, req.params.projectId);
  if (!project) return;
  const packages = await ProjectWorkPackage.find({
    tenantKey: project.tenantKey,
    projectId: project._id
  }).sort({ order: 1, createdAt: 1 }).lean();
  res.json({ packages });
});

async function validPackageUnits(project, rawUnitIds) {
  const ids = [...new Set((Array.isArray(rawUnitIds) ? rawUnitIds : []).map(String))]
    .filter(value => mongoose.Types.ObjectId.isValid(value));
  if (!ids.length) return [];
  const units = await Unit.find({
    _id: { $in: ids }, projectId: project._id, tenantKey: project.tenantKey, deletedAt: null
  }).select('_id').lean();
  return units.map(unit => unit._id);
}

async function overlappingWorkPackage(project, unitIds, excludeId = null) {
  const query = {
    tenantKey: project.tenantKey,
    projectId: project._id,
    unitIds: { $in: unitIds }
  };
  if (excludeId) query._id = { $ne: excludeId };
  return ProjectWorkPackage.findOne(query).select('name').lean();
}

router.post('/projects/:projectId/work-packages', requireProjectAccess({ commercialOnlySales: false }), async (req, res) => {
  const project = await loadTenantProject(req, res, req.params.projectId);
  if (!project) return;
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'El nombre del paquete es obligatorio.' });
  const unitIds = await validPackageUnits(project, req.body?.unitIds);
  if (!unitIds.length) return res.status(400).json({ error: 'Selecciona al menos una unidad.' });
  const overlapping = await overlappingWorkPackage(project, unitIds);
  if (overlapping) return res.status(409).json({ error: `Hay unidades que ya pertenecen al paquete ${overlapping.name}.` });
  const count = await ProjectWorkPackage.countDocuments({ tenantKey: project.tenantKey, projectId: project._id });
  const workPackage = await ProjectWorkPackage.create({
    tenantKey: project.tenantKey,
    projectId: project._id,
    name,
    contractorName: String(req.body?.contractorName || '').trim(),
    unitIds,
    startDate: req.body?.startDate || null,
    endDate: req.body?.endDate || null,
    notes: String(req.body?.notes || '').trim(),
    order: Number.isFinite(Number(req.body?.order)) ? Math.max(0, Number(req.body.order)) : count,
    createdBy: userName(req),
    updatedBy: userName(req)
  });
  res.status(201).json({ package: workPackage });
});

router.put('/work-packages/:id', attachProjectFromWorkPackage, requireProjectAccess({ commercialOnlySales: false }), async (req, res) => {
  const workPackage = req.workPackage;
  const project = req.project;
  const name = String(req.body?.name ?? workPackage.name).trim();
  if (!name) return res.status(400).json({ error: 'El nombre del paquete es obligatorio.' });
  const unitIds = req.body?.unitIds === undefined
    ? workPackage.unitIds
    : await validPackageUnits(project, req.body.unitIds);
  if (!unitIds.length) return res.status(400).json({ error: 'Selecciona al menos una unidad.' });
  const overlapping = await overlappingWorkPackage(project, unitIds, workPackage._id);
  if (overlapping) return res.status(409).json({ error: `Hay unidades que ya pertenecen al paquete ${overlapping.name}.` });
  workPackage.name = name;
  workPackage.contractorName = String(req.body?.contractorName ?? workPackage.contractorName ?? '').trim();
  workPackage.unitIds = unitIds;
  if (req.body?.startDate !== undefined) workPackage.startDate = req.body.startDate || null;
  if (req.body?.endDate !== undefined) workPackage.endDate = req.body.endDate || null;
  if (req.body?.notes !== undefined) workPackage.notes = String(req.body.notes || '').trim();
  workPackage.updatedBy = userName(req);
  await workPackage.save();
  res.json({ package: workPackage });
});

router.put('/work-packages/:id/checklist-progress', attachProjectFromWorkPackage, requireProjectAccess({ commercialOnlySales: false }), async (req, res) => {
  const workPackage = req.workPackage;
  const project = req.project;
  const tenantKey = getTenantKey(req);
  const checklistId = String(req.body?.checklistId || '');
  const subtaskId = String(req.body?.subtaskId || '__checklist__').trim();
  if (!mongoose.Types.ObjectId.isValid(checklistId)) return res.status(400).json({ error: 'Checklist inválido.' });
  if (typeof req.body?.completed !== 'boolean') return res.status(400).json({ error: 'completed debe ser booleano.' });
  const checklist = await ProjectChecklist.findOne({
    _id: checklistId,
    projectId: project._id,
    ...legacyTenantQuery(tenantKey),
    phase: { $in: ['CONTRATISTAS', 'OBRA'] }
  });
  if (!checklist) return res.status(404).json({ error: 'Checklist no encontrado.' });
  const validSubtaskIds = checklist.subtasks?.length
    ? checklist.subtasks.map(item => String(item._id))
    : ['__checklist__'];
  if (!validSubtaskIds.includes(subtaskId)) return res.status(400).json({ error: 'Actividad inválida.' });
  const current = workPackage.checklistStates.find(item =>
    String(item.checklistId) === checklistId && item.subtaskId === subtaskId
  );
  const value = {
    checklistId: checklist._id,
    subtaskId,
    completed: req.body.completed,
    completedAt: req.body.completed ? new Date() : null,
    completedBy: req.body.completed ? userName(req) : ''
  };
  if (current) Object.assign(current, value);
  else workPackage.checklistStates.push(value);
  workPackage.updatedBy = userName(req);
  await workPackage.save();
  res.json({ ok: true, package: workPackage });
});

router.delete('/work-packages/:id', attachProjectFromWorkPackage, requireProjectAccess({ commercialOnlySales: false }), async (req, res) => {
  const pinErr = requirePin(req, res); if (pinErr) return;
  await ProjectWorkPackage.deleteOne({ _id: req.workPackage._id, tenantKey: getTenantKey(req) });
  res.json({ ok: true });
});

router.put('/checklists/:id/unit-progress', attachProjectFromChecklist, requireProjectAccess({ commercialOnlySales: false }), async (req, res) => {
  const checklist = await loadTenantChecklist(req, res, req.params.id);
  if (!checklist) return;
  if (!['CONTRATISTAS', 'OBRA'].includes(String(checklist.phase || '').toUpperCase())) {
    return res.status(400).json({ error: 'Este checklist no se gestiona por unidad.' });
  }
  const unitIds = [...new Set((Array.isArray(req.body?.unitIds) ? req.body.unitIds : []).map(String))]
    .filter(value => mongoose.Types.ObjectId.isValid(value));
  const subtaskId = String(req.body?.subtaskId || '__checklist__').trim();
  if (!unitIds.length) return res.status(400).json({ error: 'Selecciona al menos una unidad.' });
  if (!subtaskId) return res.status(400).json({ error: 'subtaskId requerido.' });
  if (typeof req.body?.completed !== 'boolean') return res.status(400).json({ error: 'completed debe ser booleano.' });
  const validSubtaskIds = checklist.subtasks?.length
    ? checklist.subtasks.map(item => String(item._id))
    : ['__checklist__'];
  if (!validSubtaskIds.includes(subtaskId)) {
    return res.status(400).json({ error: 'La actividad no pertenece a este checklist.' });
  }

  const validUnits = await Unit.find({
    _id: { $in: unitIds }, projectId: checklist.projectId, tenantKey: checklist.tenantKey, deletedAt: null
  }).select('_id').lean();
  const now = new Date();
  const actor = userName(req);
  await Promise.all(validUnits.map(async unit => {
    const row = await UnitChecklistProgress.findOneAndUpdate(
      { tenantKey: checklist.tenantKey, projectId: checklist.projectId, checklistId: checklist._id, unitId: unit._id },
      { $setOnInsert: { tenantKey: checklist.tenantKey, projectId: checklist.projectId, checklistId: checklist._id, unitId: unit._id } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    const current = row.states.find(item => item.subtaskId === subtaskId);
    const value = {
      subtaskId,
      completed: req.body.completed,
      completedAt: req.body.completed ? now : null,
      completedBy: req.body.completed ? actor : ''
    };
    if (current) Object.assign(current, value);
    else row.states.push(value);
    row.updatedBy = actor;
    await row.save();
  }));
  res.json({ ok: true, modified: validUnits.length });
});

// POST /api/projects/:projectId/checklists (ad-hoc)
// acepta roleOwner y visibleToRoles; mantiene "role" legacy para compat
router.post('/projects/:projectId/checklists', requireProjectAccess({ commercialOnlySales: false }), async (req, res) => {
  const { projectId } = req.params;
  const project = await loadTenantProject(req, res, projectId);
  if (!project) return;
    if (!mongoose.Types.ObjectId.isValid(projectId)) {
    return res.status(400).json({ error: 'projectId inválido' });
  }
  const projectIdObj = new mongoose.Types.ObjectId(projectId);
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
    tenantKey: project.tenantKey,
    projectId: projectIdObj,
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
router.put('/checklists/:id', attachProjectFromChecklist, requireProjectAccess({ commercialOnlySales: false }), async (req, res) => {
  const { id } = req.params;
  const patch = { ...req.body, updatedBy: userName(req) };

  // Normaliza si el front envía roleOwner / visibleToRoles como strings
  if (typeof patch.roleOwner === 'string') patch.roleOwner = norm(patch.roleOwner);
  if (Array.isArray(patch.visibleToRoles)) {
    patch.visibleToRoles = patch.visibleToRoles.map(norm);
  } else if (typeof patch.visibleToRoles === 'string') {
    patch.visibleToRoles = patch.visibleToRoles.split(',').map(s => norm(s.trim()));
  }

  const cl = await loadTenantChecklist(req, res, id);
  if (!cl) return;
  Object.assign(cl, patch);
  await cl.save();
  res.json(cl);
});

// DELETE /api/checklists/:id (PIN)
router.delete('/checklists/:id', attachProjectFromChecklist, requireProjectAccess({ commercialOnlySales: false }), async (req, res) => {
  const pinErr = requirePin(req, res); if (pinErr) return;
  const { id } = req.params;
  const cl = await loadTenantChecklist(req, res, id);
  if (!cl) return;
  await ProjectChecklist.deleteOne({ _id: cl._id, tenantKey: cl.tenantKey });
  await UnitChecklistProgress.deleteMany({ tenantKey: cl.tenantKey, checklistId: cl._id });
  await ProjectWorkPackage.updateMany(
    { tenantKey: cl.tenantKey, projectId: cl.projectId },
    { $pull: { checklistStates: { checklistId: cl._id } } }
  );
  res.json({ ok: true });
});

/* =========================================================================
   COMPLETAR / VALIDAR / NOTAS
   ========================================================================= */

// helper: ¿está activo un checklist?
async function isActiveChecklist(cl) {
  const tenantKey = cl.tenantKey;
  // Regla 1: todos los checklists del nivel anterior (misma fase) deben estar COMPLETADO
  const prevLevel = cl.level - 1;
  if (prevLevel >= 1) {
    const prev = await ProjectChecklist.find({
      tenantKey,
      projectId: cl.projectId,
      phase: cl.phase,
      level: prevLevel
    }).select('status').lean();

    if (prev.length && prev.some(x => x.status !== 'COMPLETADO')) return false;
  }
  // Regla 2: prerrequisitos explícitos (por templateKey) deben estar COMPLETADO
  if (cl.prerequisitesKeys?.length) {
    const prereq = await ProjectChecklist.find({
      tenantKey,
      projectId: cl.projectId,
      templateKey: { $in: cl.prerequisitesKeys }
    }).select('status').lean();
    if (prereq.some(x => x.status !== 'COMPLETADO')) return false;
  }
  return true;
}

// POST /api/checklists/:id/complete  { force?: boolean }
router.post('/checklists/:id/complete', attachProjectFromChecklist, requireProjectAccess({ commercialOnlySales: false }), async (req, res) => {
  const { id } = req.params;
  const { force } = req.body || {};
  const cl = await loadTenantChecklist(req, res, id);
  if (!cl) return;

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
router.post('/checklists/:id/validate', attachProjectFromChecklist, requireProjectAccess({ commercialOnlySales: false }), async (req, res) => {
  const { id } = req.params;
  const { validated } = req.body;
  const cl = await loadTenantChecklist(req, res, id);
  if (!cl) return;
  cl.validated = !!validated;
  cl.validatedBy = userName(req);
  cl.validatedAt = validated ? new Date() : null;
  await cl.save();
  res.json({ ok: true, checklist: cl });
});

// POST /api/checklists/:id/notes  { text }
router.post('/checklists/:id/notes', attachProjectFromChecklist, requireProjectAccess({ commercialOnlySales: false }), async (req, res) => {
  const { id } = req.params;
  const { text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'Texto requerido' });
  const cl = await loadTenantChecklist(req, res, id);
  if (!cl) return;
  cl.notes.push({ text, author: userName(req), userId: req.user?._id });
  await cl.save();
  res.json({ ok: true });
});

/* =========================================================================
   SUBTAREAS
   ========================================================================= */

// POST /api/checklists/:id/subtasks  { title }
router.post('/checklists/:id/subtasks', attachProjectFromChecklist, requireProjectAccess({ commercialOnlySales: false }), async (req, res) => {
  const { id } = req.params;
  const { title } = req.body || {};
  if (!title) return res.status(400).json({ error: 'Título requerido' });
  const cl = await loadTenantChecklist(req, res, id);
  if (!cl) return;
  cl.subtasks.push({ title });
  await cl.save();
  res.json({ ok: true, checklist: cl });
});

// PUT /api/checklists/:id/subtasks/:sid  { completed?, title?, dueDate? }
router.put('/checklists/:id/subtasks/:sid', attachProjectFromChecklist, requireProjectAccess({ commercialOnlySales: false }), async (req, res) => {
  const { id, sid } = req.params;
  const cl = await loadTenantChecklist(req, res, id);
  if (!cl) return;
  const st = cl.subtasks.id(sid);
  if (!st) return res.status(404).json({ error: 'Subtarea no encontrada' });
  if (typeof req.body.completed === 'boolean') st.completed = req.body.completed;
  if (typeof req.body.title === 'string') st.title = req.body.title;
  if (req.body.dueDate) st.dueDate = req.body.dueDate;
  await cl.save();
  res.json({ ok: true });
});

// DELETE /api/checklists/:id/subtasks/:sid
router.delete('/checklists/:id/subtasks/:sid', attachProjectFromChecklist, requireProjectAccess({ commercialOnlySales: false }), async (req, res) => {
  const { id, sid } = req.params;
  const cl = await loadTenantChecklist(req, res, id);
  if (!cl) return;
  const st = cl.subtasks.id(sid);
  if (!st) return res.status(404).json({ error: 'Subtarea no encontrada' });
  st.deleteOne();
  await cl.save();
  res.json({ ok: true, checklist: cl });
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
function normalizeLegacyToProjectChecklist(lc, projectId, tenantKey) {
  const status =
    lc.status === 'COMPLETADO' || lc.status === 'DONE' ? 'COMPLETADO' :
    lc.status === 'EN_PROCESO' || lc.status === 'IN_PROGRESS' ? 'EN_PROCESO' :
    'PENDIENTE';

  const owner = lc.role ? norm(lc.role) : 'tecnico';

  return {
    tenantKey,
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
router.post('/projects/:projectId/checklists/migrate-legacy', requireProjectAccess({ commercialOnlySales: false }), async (req, res) => {
  const { projectId } = req.params;
  const project = await loadTenantProject(req, res, projectId);
  if (!project) return;

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
    .find({ projectId, ...legacyTenantQuery(project.tenantKey) }, { templateKey: 1, title: 1 }).lean();
  const existingKeys = new Set(
    existing.map(x => (x.templateKey || '') + '|' + (x.title || ''))
  );

  // 3) Preparar inserciones
  const toInsert = [];
  for (const lc of legacy) {
    const sig = (lc.key || '') + '|' + (lc.title || '');
    if (existingKeys.has(sig)) continue;
    toInsert.push(normalizeLegacyToProjectChecklist(lc, projectId, project.tenantKey));
  }

  // 4) Insertar en ProjectChecklist
  if (toInsert.length) await ProjectChecklist.insertMany(toInsert);

  res.json({ ok: true, migrated: toInsert.length, skipped: legacy.length - toInsert.length });
});

module.exports = router;
