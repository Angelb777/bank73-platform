// routes/projects.js
const express = require('express');
const mongoose = require('mongoose');
const { requireRole, requireProjectAccess } = require('../middleware/rbac');
const ProjectPermit = require('../models/ProjectPermit'); 

const Project           = require('../models/Project');
const ProjectChecklist  = require('../models/ProjectChecklist');
const Document          = require('../models/Document');
const Venta             = require('../models/Venta');
const Unit              = require('../models/Unit');
const User              = require('../models/User');
const audit             = require('../utils/audit');

const router = express.Router();

const fs = require('fs');
const path = require('path');
const axios = require('axios');


/* =========================================================================
   HELPERS
   ========================================================================= */
function toObjectId(id) { return new mongoose.Types.ObjectId(id); }

function anyAssignedFilter(userId) {
  const uid = toObjectId(userId);
  return {
    $or: [
      // Legacy arrays
      { assignedUsers:       { $in: [uid] } },
      { teamUsers:           { $in: [uid] } },
      { members:             { $in: [uid] } },
      { assignedPromoters:   { $in: [uid] } },
      { assignedCommercials: { $in: [uid] } },
      { assignedLegal:       { $in: [uid] } },
      { assignedTecnicos:    { $in: [uid] } },
      { assignedGerencia:    { $in: [uid] } },
      { assignedSocios:      { $in: [uid] } },
      { assignedFinanciero:  { $in: [uid] } },
      { assignedContable:    { $in: [uid] } },

      // NUEVO: por si guardas en un mapa genérico
      { 'assignees.promoter':   { $in: [uid] } },
      { 'assignees.commercial': { $in: [uid] } },
      { 'assignees.legal':      { $in: [uid] } },
      { 'assignees.tecnico':    { $in: [uid] } },
      { 'assignees.gerencia':   { $in: [uid] } },
      { 'assignees.socios':     { $in: [uid] } },
      { 'assignees.financiero': { $in: [uid] } },
      { 'assignees.contable':   { $in: [uid] } }
    ]
  };
}


function buildProjectVisibilityQuery(req) {
  const base = { tenantKey: req.tenantKey };
  const role = (req.user?.role || '').toLowerCase();
  const uid  = req.user?._id || req.user?.userId;

  // Admin ve todo (aprobados y pendientes)
  if (role === 'admin') return base;

  // Bank: solo aprobados en cualquier listado genérico
  if (role === 'bank') return { ...base, publishStatus: 'approved' };

  // Asignados (promoter, gerencia, etc.) -> solo aprobados y donde esté asignado
  const seeAssignedRoles = [
    'promoter','gerencia','socios','financiero','contable','legal','tecnico'
  ];
  if (seeAssignedRoles.includes(role)) {
    return { ...base, publishStatus: 'approved', ...anyAssignedFilter(uid) };
  }

  // Comercial (si mantienes filtro específico; si prefieres, puedes unificar con anyAssignedFilter)
  if (role === 'commercial') {
    return { ...base, publishStatus: 'approved', assignedCommercials: { $in: [toObjectId(uid)] } };
  }

  // Resto: nada
  return { ...base, _id: { $exists: false } };
}


function buildPortfolioQuery(req) {
  // Portfolio SIEMPRE muestra solo aprobados para todos los roles, incluido admin
  const q = buildProjectVisibilityQuery(req);
  return { ...q, publishStatus: 'approved' };
}


async function validateAssignees({ tenantKey, role, ids }) {
  const uniq = Array.from(new Set((ids || []).filter(Boolean)));
  if (!uniq.length) return [];
  const users = await User.find({
    tenantKey, role, status: 'active', _id: { $in: uniq.map(toObjectId) }
  }).select('_id').lean();
  return users.map(u => u._id);
}

function sanitizeTeamSuggestion(input) {
  const allowed = ['promoter','commercial','legal','tecnico','gerencia','socios','financiero','contable'];
  const out = {};

  for (const role of allowed) {
    const raw = Array.isArray(input?.[role])
      ? input[role]
      : String(input?.[role] || '').split(/\r?\n|,/);

    out[role] = Array.from(new Set(raw
      .map(v => String(v || '').trim())
      .filter(Boolean)
      .map(v => v.slice(0, 120))
    )).slice(0, 12);
  }

  out.notes = String(input?.notes || '').trim().slice(0, 1000);
  return out;
}

/* =========================================================================
   LISTADOS SIN :id (deben ir ANTES que cualquier ruta con :id)
   ========================================================================= */

// GET /api/projects
router.get('/', async (req, res) => {
  try {
    const q = buildProjectVisibilityQuery(req);
    const publish = (req.query.publishStatus || '').toLowerCase();
    if (publish && (req.user?.role === 'admin' || req.user?.role === 'bank')) q.publishStatus = publish;
    const list = await Project.find(q).sort({ createdAt: -1 }).lean();
    res.json(list);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// GET /api/projects/portfolio (solo aprobados)
router.get('/portfolio', async (req, res) => {
  try {
    const q = buildPortfolioQuery(req);

    const projects = await Project.find(q).sort({ updatedAt: -1 }).lean();
    if (!projects.length) return res.json([]);

    const pids = projects.map(p => p._id);

    const debugEstados = await Unit.aggregate([
  { $match: { projectId: { $in: pids } } },
  {
    $group: {
      _id: {
        estado: '$estado',
        status: '$status',
        tenantKey: '$tenantKey',
        deletedAt: '$deletedAt'
      },
      count: { $sum: 1 }
    }
  }
]);

console.log('[DEBUG PORTFOLIO ESTADOS]', JSON.stringify(debugEstados, null, 2));

    const SOLD_ESTADOS = [
  // nuevos
  'reservado',
  'con_cpp',
  'tramite_legal_activado',
  'escriturado_traspasado',
  'vivienda_entregada',

  // legacy antiguos
  'en_escrituracion',
  'escriturado',
  'entregado'
];

    const agg = await Unit.aggregate([
      {
        $match: {
          projectId: { $in: pids },
          $and: [
            {
              $or: [
                { deletedAt: null },
                { deletedAt: { $exists: false } }
              ]
            },
            {
              $or: [
                { tenantKey: req.tenantKey },
                { tenantKey: { $exists: false } },
                { tenantKey: null }
              ]
            }
          ]
        }
      },
      {
        $addFields: {
          estadoNorm: {
            $toLower: {
              $ifNull: ['$estado', '$status']
            }
          }
        }
      },
      {
        $group: {
          _id: '$projectId',
          total: { $sum: 1 },
          sold: {
            $sum: {
              $cond: [
                { $in: ['$estadoNorm', SOLD_ESTADOS] },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    const byProject = new Map(agg.map(a => [String(a._id), a]));

    const out = projects.map(p => {
      const m = byProject.get(String(p._id));
      return {
        _id: p._id,
        name: p.name,
        description: p.description,
        status: p.status,
        unitsTotal: m?.total ?? p.unitsTotal ?? 0,
        unitsSold: m?.sold ?? 0,
      };
    });

    res.json(out);
  } catch (e) {
    console.error('[portfolio]', e);
    res.status(500).json({ error: e.message });
  }
});

// GET /api/projects/assignees?role=promoter|commercial|legal|tecnico|gerencia|socios|financiero|contable
router.get('/assignees', requireRole('admin','bank'), async (req, res) => {
  try {
    const role = (req.query.role || '').toLowerCase();
    const allowed = ['promoter','commercial','legal','tecnico','gerencia','socios','financiero','contable'];
    if (!allowed.includes(role)) {
      return res.status(400).json({ error: `role inválido. Usa ${allowed.join('|')}` });
    }
    const users = await User.find(
      { tenantKey: req.tenantKey, role, status: 'active' },
      { password: 0 }
    ).sort({ name: 1 }).lean();
    res.json({ users });
  } catch (e) {
    console.error('[ASSIGNEES ERROR]', e);
    res.status(500).json({ error: String(e?.message || e) });
  }
});

/* =========================================================================
   CREAR PROYECTO
   ========================================================================= */

// POST /api/projects
router.post('/', requireRole('admin','bank'), async (req, res) => {
  try {
    const tenantKey = req.tenantKey;
    const body = { ...req.body, tenantKey };

    body.publishStatus = 'pending';
    body.createdBy = toObjectId(req.user.userId);
    body.teamSuggestion = sanitizeTeamSuggestion(body.teamSuggestion || {});

    // Crear proyecto ya no requiere exponer/asignar usuarios en el alta.
    // Si llegan asignaciones legacy, se validan contra el tenant, pero son opcionales.
    const promotersRaw   = Array.isArray(body.assignedPromoters)   ? body.assignedPromoters   : [];
    const commercialsRaw = Array.isArray(body.assignedCommercials) ? body.assignedCommercials : [];

    const validPromoters   = await validateAssignees({ tenantKey, role:'promoter',   ids: promotersRaw });
    const validCommercials = await validateAssignees({ tenantKey, role:'commercial', ids: commercialsRaw });

    body.assignedPromoters   = validPromoters;
    body.assignedCommercials = validCommercials;

    // Si envías más asignaciones en el body y existen esos campos en Project, las dejamos pasar:
    const moreRoles = ['legal','tecnico','gerencia','socios','financiero','contable'];
    for (const r of moreRoles) {
      const key = ({
        legal: 'assignedLegal',
        tecnico: 'assignedTecnicos',
        gerencia: 'assignedGerencia',
        socios: 'assignedSocios',
        financiero: 'assignedFinanciero',
        contable: 'assignedContable'
      })[r];

      if (key && Array.isArray(body[key])) {
        const validated = await validateAssignees({ tenantKey, role: r, ids: body[key] });
        body[key] = validated; // si el campo no existe en el schema, Mongoose lo ignorará silenciosamente si tienes strict
      }
    }

    const p = await Project.create(body);
    await audit(req, 'project.created', {
      targetType: 'project',
      targetId: p._id,
      projectId: p._id,
      status: 'info',
      message: 'Proyecto creado',
      metadata: { name: p.name, publishStatus: p.publishStatus }
    });
    res.status(201).json(p);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/* =========================================================================
   RUTAS CON :id (deben ir DESPUÉS)
   ========================================================================= */

router.get('/:id', requireProjectAccess(), async (req, res) => {
  try {
    const { id } = req.params;
    const tenantKey = req.tenantKey;

    const p = await Project.findOne({ _id: id, tenantKey }).lean();
    if (!p) return res.status(404).json({ error: 'Proyecto no encontrado' });

    // Solo el admin puede abrir proyectos pendientes.
    const role = String(req.user?.role || '').toLowerCase();
    if (role !== 'admin' && p.publishStatus !== 'approved') {
      return res.status(403).json({ error: 'Proyecto pendiente de aprobación del administrador.' });
    }

    res.json(p);
  } catch (e) {
    console.error('[GET /projects/:id] error:', e);
    res.status(500).json({ error: 'Error obteniendo el proyecto' });
  }
});


// === Checklists por proyecto, filtrados por rol del usuario ===
// === Checklists por proyecto, filtrados por rol del usuario (roleOwner / visibleToRoles) ===
router.get('/:id/checklists', requireProjectAccess({ commercialOnlySales: false }), async (req, res) => {
  try {
    const { id } = req.params;
    const myRole = String(req.user?.role || '').toLowerCase().trim();

    // Roles con acceso total
    const FULL = ['admin','bank','promoter','gerencia','socios','financiero','contable'];

    // Filtro base por proyecto (acepta datos legacy sin tenantKey)
    const baseFilter = {
      projectId: new mongoose.Types.ObjectId(id),
      $or: [
        { tenantKey: req.tenantKey },
        { tenantKey: { $exists: false } }
      ]
    };

    // Si no es full-access: limitar por rol
    const query = FULL.includes(myRole)
      ? baseFilter
      : {
          ...baseFilter,
          $or: [
            { roleOwner: myRole },
            { visibleToRoles: myRole }
          ]
        };

    // Orden correcto según tu schema
    const checklists = await ProjectChecklist
      .find(query)
      .sort({ level: 1, orderInLevel: 1, createdAt: 1 })
      .lean();

    res.json({ checklists });
  } catch (e) {
    console.error('[GET /projects/:id/checklists] error:', e);
    res.status(500).json({ error: e.message });
  }
});


// PUT /api/projects/:id
// PUT /api/projects/:id
// - admin: puede editar nombre, descripción, KPIs y status (como antes)
// - bank:  solo puede cambiar el status del proyecto
router.put('/:id', requireRole('admin','bank'), async (req, res) => {
  try {
    const { id } = req.params;
    const tenantKey = req.tenantKey;
    const myRole = String(req.user?.role || '').toLowerCase();

    // ===== Validación de status permitido =====
    const VALID_STATUS = ['EN_CURSO','EN_MARCHA','PAUSADO','FINALIZADO'];

    // ---- WHITELIST ----
    const payload = {};

    if (myRole === 'admin') {
      // Admin conserva la edición completa
      if (typeof req.body.name === 'string')        payload.name = req.body.name.trim();
      if (typeof req.body.description === 'string') payload.description = req.body.description.trim();

      if (typeof req.body.status === 'string') {
        const st = req.body.status.trim().toUpperCase();
        if (!VALID_STATUS.includes(st)) {
          return res.status(400).json({ error: `status inválido. Usa: ${VALID_STATUS.join(', ')}` });
        }
        payload.status = st;
      }

      // KPIs numéricos: convertimos y validamos
      const asNum = (v) => (v === '' || v === null || v === undefined) ? undefined : Number(v);
      const kpis = {
        loanApproved:   asNum(req.body.loanApproved),
        loanDisbursed:  asNum(req.body.loanDisbursed),
        loanBalance:    asNum(req.body.loanBalance),
        budgetApproved: asNum(req.body.budgetApproved),
        budgetSpent:    asNum(req.body.budgetSpent),
        unitsTotal:     asNum(req.body.unitsTotal),
        unitsSold:      asNum(req.body.unitsSold),
      };
      for (const [k, v] of Object.entries(kpis)) {
        if (typeof v === 'number' && !Number.isNaN(v)) payload[k] = v;
      }
    } else {
  // === BANK ===
  // Permitimos cambiar status (opcional) + KPIs financieros básicos (opcionales)

  const asNum = (v) => (v === '' || v === null || v === undefined) ? undefined : Number(v);

  // ✅ status (opcional, no obligatorio)
  if (typeof req.body.status === 'string' && req.body.status.trim()) {
    const st = req.body.status.trim().toUpperCase();
    if (!VALID_STATUS.includes(st)) {
      return res.status(400).json({ error: `status inválido. Usa: ${VALID_STATUS.join(', ')}` });
    }
    payload.status = st;
  }

  // ✅ KPIs (opcionales)
  const kpis = {
    loanApproved:   asNum(req.body.loanApproved),
    loanDisbursed:  asNum(req.body.loanDisbursed),
    budgetApproved: asNum(req.body.budgetApproved),
    budgetSpent:    asNum(req.body.budgetSpent),
  };

  for (const [k, v] of Object.entries(kpis)) {
    if (typeof v === 'number' && !Number.isNaN(v)) payload[k] = v;
  }

  // Si no mandaron nada válido, devolvemos error claro
  if (Object.keys(payload).length === 0) {
    return res.status(400).json({ error: 'No hay campos válidos para actualizar' });
  }
  }

    if (Object.keys(payload).length === 0) {
      return res.status(400).json({ error: 'No hay campos válidos para actualizar' });
    }

    // Opcional: marca quién actualizó
    payload.updatedBy = req.user?.userId || req.user?._id;

    const updated = await Project.findOneAndUpdate(
      { _id: id, tenantKey },
      { $set: payload },
      { new: true }
    ).lean();

    if (!updated) return res.status(404).json({ error: 'Proyecto no encontrado' });
    await audit(req, 'project.updated', {
      targetType: 'project',
      targetId: updated._id,
      projectId: updated._id,
      message: 'Proyecto actualizado',
      metadata: { name: updated.name, fields: Object.keys(payload) }
    });
    res.json({ ok: true, project: updated });
  } catch (err) {
    console.error('[PUT /api/projects/:id]', err);
    res.status(500).json({ error: 'Error actualizando el proyecto' });
  }
});

router.delete('/:id', requireRole('admin','bank'), async (req, res) => {
  const del = await Project.findOneAndDelete({ _id: req.params.id, tenantKey: req.tenantKey });
  if (!del) return res.status(404).json({ error: 'Proyecto no encontrado' });
  await audit(req, 'project.deleted', {
    targetType: 'project',
    targetId: del._id,
    projectId: del._id,
    message: 'Proyecto eliminado',
    metadata: { name: del.name, publishStatus: del.publishStatus }
  });
  res.json({ ok: true });
});

// PUT /api/projects/:id/assign
// Body admite:
// 1) genérico: { assignments: { promoter:[], commercial:[], legal:[], tecnico:[], gerencia:[], socios:[], financiero:[], contable:[] } }
// 2) legacy:   { promoters, commercials, legal, tecnico, gerencia, socios, financiero, contable }
router.put('/:id/assign', requireRole('admin','bank'), async (req, res) => {
  try {
    const { id } = req.params;
    const tenantKey = req.tenantKey;
    const body = req.body || {};

    // --- NORMALIZA INPUT ---
    let assignments = {};
    if (body.assignments && typeof body.assignments === 'object') {
      assignments = body.assignments;
    } else {
      // compat con payload legacy
      const legacyMap = {
        promoter:   body.promoters,
        commercial: body.commercials,
        legal:      body.legal,
        tecnico:    body.tecnico,
        gerencia:   body.gerencia,
        socios:     body.socios,
        financiero: body.financiero,
        contable:   body.contable
      };
      assignments = Object.fromEntries(
        Object.entries(legacyMap).filter(([_, v]) => Array.isArray(v))
      );
    }

    if (!Object.keys(assignments).length) {
      return res.json({ ok: true }); // nada que actualizar
    }

    // --- VALIDACIÓN POR ROL ---
    const roles = ['promoter','commercial','legal','tecnico','gerencia','socios','financiero','contable'];
    const validated = {};
    for (const r of roles) {
      if (Array.isArray(assignments[r])) {
        validated[r] = await validateAssignees({ tenantKey, role: r, ids: assignments[r] });
      }
    }

    // --- MAPEA a tus campos del Project (legacy) ---
    const update = {};
    if (validated.promoter)   update.assignedPromoters   = validated.promoter;
    if (validated.commercial) update.assignedCommercials = validated.commercial;
    if (validated.legal)      update.assignedLegal       = validated.legal;
    if (validated.tecnico)    update.assignedTecnicos    = validated.tecnico;
    if (validated.gerencia)   update.assignedGerencia    = validated.gerencia;
    if (validated.socios)     update.assignedSocios      = validated.socios;
    if (validated.financiero) update.assignedFinanciero  = validated.financiero;
    if (validated.contable)   update.assignedContable    = validated.contable;

    const proj = await Project.findOneAndUpdate(
      { _id: id, tenantKey },
      update,
      { new: true }
    );

    if (!proj) return res.status(404).json({ error: 'Proyecto no encontrado' });
    await audit(req, 'project.assigned', {
      targetType: 'project',
      targetId: proj._id,
      projectId: proj._id,
      message: 'Equipo asignado al proyecto',
      metadata: { name: proj.name, roles: Object.keys(validated) }
    });
    res.json({ ok: true, project: proj });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


router.get('/:id/summary', requireProjectAccess(), async (req, res) => {
  try {
    const { id } = req.params;
    const tenantKey = req.tenantKey;

    const project = await Project.findOne({ _id: id, tenantKey }).lean();
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const financePhases = Array.isArray(project?.finance?.phases) ? project.finance.phases : [];

    const [checklists, documents, ventasRaw, units, permits] = await Promise.all([
      ProjectChecklist.find({
        projectId: new mongoose.Types.ObjectId(id),
        $or: [{ tenantKey }, { tenantKey: { $exists: false } }]
      }).lean(),
      Document.find({ tenantKey, projectId: id }).sort({ createdAt: -1 }).lean(),
      Venta.find({ tenantKey, projectId: id, deletedAt: null }).lean(),
      Unit.find({ tenantKey, projectId: id, deletedAt: null }).lean(),
      (async () => {
        try {
          return await ProjectPermit.findOne({ tenantKey, projectId: id }).lean();
        } catch {
          return null;
        }
      })()
    ]);

    // =========================
    // Helpers
    // =========================
    const norm = s => String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase();

    const clean = s => String(s || '').trim();

    const toNum = (v) => {
      if (v === '' || v === null || v === undefined) return 0;
      if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
      const n = Number(String(v).replace(/\./g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : 0;
    };

    const toTime = (v) => {
      if (!v) return null;
      const t = new Date(v).getTime();
      return Number.isFinite(t) ? t : null;
    };

    const unitKey = (mz, lt) =>
      `${clean(mz).toUpperCase()}|${clean(lt).toUpperCase()}`;

    const countBy = (arr, labelFn, valueFn = () => 1) => {
      const map = new Map();
      for (const item of arr || []) {
        const label = clean(labelFn(item)) || 'N/D';
        const val = valueFn(item);
        const prev = map.get(label) || { label, count: 0, amount: 0 };
        prev.count += 1;
        prev.amount += toNum(val);
        map.set(label, prev);
      }
      return Array.from(map.values()).sort((a, b) => b.count - a.count);
    };

    const isYes = (v) => {
      const t = norm(v);
      return ['SI', 'S', 'YES', 'Y', 'TRUE', '1', 'OK', 'X'].includes(t);
    };

    const hasText = (v) => !!clean(v);

    const getVentaKey = (v) => {
      const lotKey = unitKey(v?.manzana, v?.lote);
      if (lotKey !== '|') return `LOT:${lotKey}`;

      const unitId = v?.unitId ? String(v.unitId) : '';
      if (unitId) return `UNIT:${unitId}`;

      return null;
    };

    const getVentaSortTs = (v) =>
      toTime(v?.updatedAt) ||
      toTime(v?.createdAt) ||
      toTime(v?.fechaContratoCliente) ||
      0;

    const getCppDueDate = (v) =>
      v?.fechaVencimientoCPP ||
      v?.vencimientoCPP ||
      v?.vencimientoCPPBnMivi ||
      v?.vencimientoCPP_BNMIVI ||
      v?.vencimientoCPPBNMIVI ||
      null;

    const getUnitStatus = (u) => {
      const st = norm(u?.estado || u?.status);

      if (st.includes('CANCEL') || st.includes('ANUL')) return 'cancelado';
      if (st.includes('VIVIENDA_ENTREGADA') || st.includes('VIVIENDA ENTREGADA') || st.includes('ENTREG')) return 'vivienda_entregada';
      if (st.includes('ESCRITURADO_TRASPASADO') || st.includes('ESCRITURADO TRASPASADO') || st.includes('ESCRITURAD') || st.includes('TRASPAS')) return 'escriturado_traspasado';
      if (st.includes('TRAMITE_LEGAL_ACTIVADO') || st.includes('TRAMITE LEGAL ACTIVADO') || st.includes('INGRESO_RP') || st.includes('INGRESO RP')) return 'tramite_legal_activado';
      if (st.includes('CON_CPP') || st.includes('CON CPP') || st === 'CPP') return 'con_cpp';
      if (st.includes('EN_ESCRIT') || st.includes('EN ESCRIT') || st.includes('ESCRITURACION')) return 'tramite_legal_activado';
      if (st.includes('RESERV')) return 'reservado';
      if (st.includes('INVENTARIO')) return 'inventario';

      return 'disponible';
    };

    const isSoldLikeStatus = (st) =>
      ['reservado', 'con_cpp', 'tramite_legal_activado', 'escriturado_traspasado', 'vivienda_entregada'].includes(st);

    const hasClientSignal = (v) =>
      !!clean(v?.clienteNombre) ||
      !!clean(v?.cedula) ||
      !!clean(v?.empresa) ||
      !!clean(v?.primerNombre) ||
      !!clean(v?.primerApellido);

    const hasBankSignal = (v) => !!clean(v?.banco);

    const hasCppSignal = (v) => {
      const sb = norm(v?.statusBanco);
      return (
        /CPP|APROB|CON CPP|INC|DESEMBOLS/.test(sb) ||
        !!clean(v?.numCPP) ||
        !!v?.recibidoCPP ||
        !!v?.fechaValorCPP
      );
    };

    const isCommitteeSignal = (v) => {
      const sb = norm(v?.statusBanco);
      return sb.includes('COMITE') || sb.includes('COMITÉ');
    };

    const hasMortgageSignal = (v) => {
      const sb = norm(v?.statusBanco);
      return (
        !!clean(v?.banco) &&
        (
          sb.includes('DESEMBOLSO') ||
          sb.includes('HIPOTECA') ||
          sb.includes('FORMALIZADO') ||
          sb.includes('ESCRITURADO') ||
          !!v?.fechaInscripcion
        )
      );
    };

    const getEffectivePrice = (venta, unit) => {
      const ventaPrecio = toNum(venta?.precioVenta);
      if (ventaPrecio > 0) return ventaPrecio;

      const unitValor = toNum(unit?.precioLista);
      if (unitValor > 0) return unitValor;

      const ventaValorLegacy = toNum(venta?.valor);
      if (ventaValorLegacy > 0) return ventaValorLegacy;

      return 0;
    };

    const getMortgageAmount = (venta, unit) => {
      const bank = norm(venta?.banco);

      if (bank.includes('CONTADO')) return getEffectivePrice(venta, unit);

      const financed = toNum(venta?.montoFinanciamientoCPP);
      if (financed > 0) return financed;

      return getEffectivePrice(venta, unit);
    };

    const getModel = (v) =>
      clean(v?.__unit?.modelo || v?.modelo || 'Sin modelo');

    // =========================
    // Normalizar / deduplicar ventas
    // =========================
    const unitById = new Map((units || []).map(u => [String(u._id), u]));
    const unitByLot = new Map((units || []).map(u => [unitKey(u.manzana, u.lote), u]));

    const ventasByCurrentKey = new Map();
    for (const v of (ventasRaw || [])) {
      const key = getVentaKey(v);
      if (!key) continue;

      const prev = ventasByCurrentKey.get(key);
      if (!prev || getVentaSortTs(v) >= getVentaSortTs(prev)) {
        ventasByCurrentKey.set(key, v);
      }
    }

    const ventas = [];
    for (const v of ventasByCurrentKey.values()) {
      let u = null;

      if (v?.unitId) u = unitById.get(String(v.unitId)) || null;
      if (!u) u = unitByLot.get(unitKey(v?.manzana, v?.lote)) || null;
      if (!u) continue;

      ventas.push({
        ...v,
        __unit: u,
        __unitStatus: getUnitStatus(u)
      });
    }

    // =========================
    // Progreso por fase
    // =========================
    function checklistProgress(cl) {
      const subs = Array.isArray(cl?.subtasks) ? cl.subtasks
        : (Array.isArray(cl?.children) ? cl.children : []);

      if (!subs.length) {
        const st = norm(cl?.status);
        if (cl?.validated || /COMPLETADO|DONE/.test(st)) return 100;
        if (/EN_PROCESO|IN_PROGRESS/.test(st)) return 50;
        return 0;
      }

      const done = subs.filter(s => !!s.completed).length;
      return Math.round((done / subs.length) * 100);
    }

    const LEVEL2PHASE = {
      1: 'PREESTUDIOS',
      2: 'PERMISOS',
      3: 'FINANCIACION',
      4: 'CONTRATISTAS',
      5: 'OBRA',
      6: 'ESCRITURACION'
    };

    const byLevel = new Map();
    for (const cl of (checklists || [])) {
      const lvl = Number(cl.level || 0) || 0;
      if (!LEVEL2PHASE[lvl]) continue;
      const arr = byLevel.get(lvl) || [];
      arr.push(checklistProgress(cl));
      byLevel.set(lvl, arr);
    }

    const progressByPhase = Object.entries(LEVEL2PHASE).map(([lvl, phase]) => {
      const arr = byLevel.get(Number(lvl)) || [];
      const pct = arr.length
        ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
        : 0;
      return { phase, pct };
    });

    // =========================
    // Unidades / inventario
    // =========================
    const U = {
      total: 0,
      available: 0,
      inventory: 0,
      reserved: 0,
      conCpp: 0,
      tramiteLegal: 0,
      escrituradas: 0,
      entregadas: 0,
      sold: 0,
      canceladas: 0
    };

    for (const u of (units || [])) {
      U.total++;
      const st = getUnitStatus(u);

      if (st === 'cancelado') U.canceladas++;
      else if (st === 'reservado') U.reserved++;
      else if (st === 'con_cpp') U.conCpp++;
      else if (st === 'tramite_legal_activado') U.tramiteLegal++;
      else if (st === 'escriturado_traspasado') U.escrituradas++;
      else if (st === 'vivienda_entregada') U.entregadas++;
      else if (st === 'inventario') U.inventory++;
      else U.available++;

      if (isSoldLikeStatus(st)) U.sold++;
    }

    const unitsByStatus = [
      { status: 'Libre', count: U.available },
      { status: 'Inventario', count: U.inventory },
      { status: 'Reserva', count: U.reserved },
      { status: 'Con CPP', count: U.conCpp },
      { status: 'Trámite legal', count: U.tramiteLegal },
      { status: 'Escriturado / Traspasado', count: U.escrituradas },
      { status: 'Vivienda entregada', count: U.entregadas },
      { status: 'Cancelada', count: U.canceladas }
    ];

    const soldVentas = (ventas || []).filter(v => isSoldLikeStatus(v.__unitStatus));

    // =========================
    // Comercial
    // =========================
    const now = Date.now();
    const d30 = 30 * 24 * 3600 * 1000;
    const d60 = 60 * 24 * 3600 * 1000;
    const d90 = 90 * 24 * 3600 * 1000;

    const salesMap = new Map();
    const salesYearMap = new Map();
    const fallenSalesYearMap = new Map();

    for (const v of (ventas || [])) {
      const d = v?.fechaContratoCliente ? new Date(v.fechaContratoCliente) : null;
      const year = d && !isNaN(d.getTime()) ? String(d.getFullYear()) : null;

      if (isSoldLikeStatus(v.__unitStatus) && year) {
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        salesMap.set(monthKey, (salesMap.get(monthKey) || 0) + 1);
        salesYearMap.set(year, (salesYearMap.get(year) || 0) + 1);
      }

            const st = norm(v?.estatusContrato || v?.statusBanco || v?.comentario);
      const unitSt = v.__unitStatus;

      // ✅ Venta caída REAL:
      // marcada desde routes/units.js cuando pasa de vendido/reservado a disponible
      const isFallen =
        String(v?.estadoVenta || '').toLowerCase() === 'caida' ||
        unitSt === 'cancelado' ||
        st.includes('CAIDA') ||
        st.includes('CAÍDA') ||
        st.includes('CANCEL') ||
        st.includes('ANUL');

      if (isFallen) {
        const fechaCaida = v?.fechaCaida || v?.updatedAt || v?.createdAt || Date.now();
        const y = String(new Date(fechaCaida).getFullYear());
        fallenSalesYearMap.set(y, (fallenSalesYearMap.get(y) || 0) + 1);
      }
    }

    const salesMonthly = Array.from(salesMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([month, units]) => ({ month, units }));

    const years = Array.from(new Set([
      ...salesYearMap.keys(),
      ...fallenSalesYearMap.keys()
    ])).sort();

    const salesVsFallenByYear = years.map(year => {
      const sales = salesYearMap.get(year) || 0;
      const fallen = fallenSalesYearMap.get(year) || 0;
      return {
        year,
        sales,
        fallen,
        total: sales + fallen
      };
    });

    const modelMap = new Map();
    for (const v of soldVentas) {
      const model = getModel(v);
      modelMap.set(model, (modelMap.get(model) || 0) + 1);
    }

    const salesByModel = Array.from(modelMap.entries())
      .map(([model, count]) => ({ model, count }))
      .sort((a, b) => b.count - a.count);

    const clientProfile = countBy(
      soldVentas.filter(v => clean(v.perfilCliente)),
      v => v.perfilCliente
    ).map(x => ({ profile: x.label, count: x.count }));

    const companyType = countBy(
      soldVentas.filter(v => clean(v.tipoEmpresa)),
      v => v.tipoEmpresa
    ).map(x => ({ type: x.label, count: x.count }));

    const bankStatusMap = new Map();
    const bankStatusLabel = (v) => {
      const sb = norm(v.statusBanco);

      if (hasCppSignal(v)) return 'Con CPP';
      if (sb.includes('APROB')) return 'Aprobado';
      if (sb.includes('COMITE') || sb.includes('COMITÉ')) return 'Comité';
      if (sb.includes('EVALU')) return 'Evaluación';
      if (sb.includes('PEND')) return 'Pendiente doc';
      if (!clean(v.banco)) return 'Sin banco';

      return clean(v.statusBanco) || 'Otros';
    };

    for (const v of soldVentas) {
      const label = bankStatusLabel(v);
      bankStatusMap.set(label, (bankStatusMap.get(label) || 0) + 1);
    }

    const bankStatus = Array.from(bankStatusMap.entries())
      .map(([status, count]) => ({ status, count }))
      .sort((a, b) => b.count - a.count);

    const cppByBankMap = new Map();
    const cppAmountByBankMap = new Map();
    const cppCommitteeByBankMap = new Map();

    let cppDue30 = 0;
    let cppDue60 = 0;
    let cppDue90 = 0;
    let cppActive = 0;

    for (const v of soldVentas) {
      if (!hasClientSignal(v) && !hasBankSignal(v) && !hasCppSignal(v)) continue;

      const bank = clean(v.banco) || 'Sin banco';

      if (hasCppSignal(v)) {
        cppActive++;
        cppByBankMap.set(bank, (cppByBankMap.get(bank) || 0) + 1);

        const prev = cppAmountByBankMap.get(bank) || { bank, count: 0, amount: 0 };
        prev.count += 1;
        prev.amount += getMortgageAmount(v, v.__unit);
        cppAmountByBankMap.set(bank, prev);

        const venc = getCppDueDate(v);
        const vt = toTime(venc);

        if (vt) {
          const diff = vt - now;
          if (diff <= d30) cppDue30++;
          else if (diff <= d60) cppDue60++;
          else if (diff <= d90) cppDue90++;
        }
      }

      if (isCommitteeSignal(v)) {
        cppCommitteeByBankMap.set(bank, (cppCommitteeByBankMap.get(bank) || 0) + 1);
      }
    }

    const cppByBank = Array.from(cppByBankMap.entries())
      .map(([bank, count]) => ({ bank, count }))
      .sort((a, b) => b.count - a.count);

    const cppAmountByBank = Array.from(cppAmountByBankMap.values())
      .sort((a, b) => b.amount - a.amount);

    const cppCommitteeByBank = Array.from(cppCommitteeByBankMap.entries())
      .map(([bank, count]) => ({ bank, count }))
      .sort((a, b) => b.count - a.count);

    const profMap = new Map();
    for (const v of soldVentas) {
      if (!/PROFORMA/.test(norm(v.statusBanco)) && !v.fechaEntregaProformaBanco && !v.fechaProforma) continue;
      const bank = clean(v.banco) || 'Sin banco';
      profMap.set(bank, (profMap.get(bank) || 0) + 1);
    }

    const proformasByBank = Array.from(profMap.entries())
      .map(([bank, count]) => ({ bank, count }))
      .sort((a, b) => b.count - a.count);

    const mortMap = new Map();
    let clientMortgages30d = 0;

    for (const v of soldVentas) {
      if (!hasClientSignal(v)) continue;
      if (!hasMortgageSignal(v)) continue;

      const bank = clean(v.banco) || 'Sin banco';
      const prev = mortMap.get(bank) || { count: 0, amount: 0 };

      prev.count += 1;
      prev.amount += getMortgageAmount(v, v.__unit);
      mortMap.set(bank, prev);

      const fd = v.updatedAt || v.fechaValorCPP || v.recibidoCPP || v.fechaContratoCliente;
      const ft = toTime(fd);
      if (ft && (now - ft) <= d30) clientMortgages30d++;
    }

    const mortgagesByBank = Array.from(mortMap.entries())
      .map(([bank, data]) => ({ bank, count: data.count, amount: data.amount }))
      .sort((a, b) => b.amount - a.amount);

    const commercial = {
      inventoryByStatus: unitsByStatus,
      salesVsFallenByYear,
      salesByModel,
      clientProfile,
      companyType,
      bankStatus,
      cppAmountByBank,
      cppCommitteeByBank
    };

    // =========================
    // Legal / Jurídico
    // =========================
    const legalSold = soldVentas;

    const legalTotals = {
      contratosFirmados: legalSold.filter(v => !!v.contratoFirmado || !!v.fechaContratoCliente || !!v.fechaFirma).length,
      minutasLiberacion: legalSold.filter(v => hasText(v.mLiberacion) || isYes(v.mLiberacion)).length,
      minutasSegregacion: legalSold.filter(v => hasText(v.mSegregacion) || isYes(v.mSegregacion)).length,
      minutasPrestamo: legalSold.filter(v => hasText(v.mPrestamo) || isYes(v.mPrestamo)).length,
      protocolosCliente: legalSold.filter(v => !!v.protocoloFirmaCliente).length,
      protocolosBancoCliente: legalSold.filter(v => !!v.firmaProtocoloBancoCliente).length,
      protocolosBanco: legalSold.filter(v => !!v.protocoloFirmaRLBancoInter).length,
      escriturasInscritas: legalSold.filter(v => !!v.fechaInscripcion).length,
      fincasSegregadas: legalSold.filter(v => hasText(v.numeroFinca)).length
    };

    const legalYesNo = (field) => {
      const yes = legalSold.filter(v => hasText(v[field]) || v[field] === true).length;
      const no = Math.max(legalSold.length - yes, 0);
      return [
        { status: 'Sí', count: yes },
        { status: 'No', count: no }
      ];
    };

    const protocolByBankMap = new Map();
    for (const v of legalSold) {
      const bank = clean(v.banco) || 'Sin banco';
      const prev = protocolByBankMap.get(bank) || {
        bank,
        cliente: 0,
        bancoCliente: 0,
        bancoInterino: 0
      };

      if (v.protocoloFirmaCliente) prev.cliente++;
      if (v.firmaProtocoloBancoCliente) prev.bancoCliente++;
      if (v.protocoloFirmaRLBancoInter) prev.bancoInterino++;

      protocolByBankMap.set(bank, prev);
    }

    const legal = {
      totals: legalTotals,
      minutasLiberacion: legalYesNo('mLiberacion'),
      minutasSegregacion: legalYesNo('mSegregacion'),
      minutasPrestamo: legalYesNo('mPrestamo'),
      protocolByBank: Array.from(protocolByBankMap.values())
    };

    // =========================
    // Técnico
    // =========================
    const constructionStatusMap = new Map();
    const constructionPhaseMap = new Map();
    const constructionModelMap = new Map();
    const constructionRangeMap = new Map([
      ['0%', 0],
      ['1%-33%', 0],
      ['34%-66%', 0],
      ['67%-99%', 0],
      ['100%', 0]
    ]);

    const technicalUnits = units || [];

    for (const u of technicalUnits) {
      const venta = ventas.find(v => String(v.unitId) === String(u._id)) || null;

      const estatusConstruccion =
        clean(venta?.estatusConstruccion) ||
        clean(u?.estatusConstruccion) ||
        (venta?.enConstruccion ? 'En construcción' : '');

      const faseConstruccion =
        clean(venta?.faseConstruccion) ||
        clean(u?.faseConstruccion) ||
        'Sin fase';

      const model = clean(u?.modelo) || 'Sin modelo';

      if (estatusConstruccion) {
        constructionStatusMap.set(estatusConstruccion, (constructionStatusMap.get(estatusConstruccion) || 0) + 1);
      }

      constructionPhaseMap.set(faseConstruccion, (constructionPhaseMap.get(faseConstruccion) || 0) + 1);

      if (venta?.enConstruccion || estatusConstruccion || faseConstruccion !== 'Sin fase') {
        constructionModelMap.set(model, (constructionModelMap.get(model) || 0) + 1);
      }

      const pct = toNum(u?.avanceConstruccionPct ?? venta?.avanceConstruccionPct ?? 0);
      let range = '0%';
      if (pct >= 100) range = '100%';
      else if (pct >= 67) range = '67%-99%';
      else if (pct >= 34) range = '34%-66%';
      else if (pct >= 1) range = '1%-33%';

      constructionRangeMap.set(range, (constructionRangeMap.get(range) || 0) + 1);
    }

    const technical = {
      constructionStatus: Array.from(constructionStatusMap.entries()).map(([status, count]) => ({ status, count })),
      constructionPhase: Array.from(constructionPhaseMap.entries()).map(([phase, count]) => ({ phase, count })),
      modelsInConstruction: Array.from(constructionModelMap.entries()).map(([model, count]) => ({ model, count })),
      constructionProgressRanges: Array.from(constructionRangeMap.entries()).map(([range, count]) => ({ range, count })),
      permitsTotals: {
        construction: ventas.filter(v => !!v.permisoConstruccionMunicipal || hasText(v.permisoConstruccionNum)).length,
        occupation: ventas.filter(v => !!v.permisoOcupacion || hasText(v.permisoOcupacionNum)).length
      }
    };

    // =========================
    // Permisos por institución
    // =========================
    const byInst = {};
    const permitItems = Array.isArray(permits?.items) ? permits.items : [];

    for (const it of permitItems) {
      const inst = clean(it.institution) || 'N/D';
      const st = norm(it.status);

      byInst[inst] ||= { institution: inst, approved: 0, inProcess: 0, pending: 0, rejected: 0 };

      if (st === 'APPROVED' || st === 'APROBADO' || /APROB/.test(st)) {
        byInst[inst].approved++;
      } else if (st.includes('RECHAZ')) {
        byInst[inst].rejected++;
      } else if (
        st === 'IN_PROCESS' ||
        st === 'EN_TRAMITE' ||
        st === 'EN TRAMITE' ||
        st === 'TRAMITE' ||
        /TRAM|PROC|EN PROCESO/.test(st)
      ) {
        byInst[inst].inProcess++;
      } else {
        byInst[inst].pending++;
      }
    }

    const permitsByInstitution = Object.values(byInst)
      .sort((a, b) =>
        (b.approved + b.inProcess + b.pending + b.rejected) -
        (a.approved + a.inProcess + a.pending + a.rejected)
      );

    // =========================
    // Financiero
    // =========================
    const creditLines = Array.isArray(project?.creditLines)
      ? project.creditLines
      : [];

    const normalizedCreditLines = creditLines.map(line => {
      const approvedAmount = toNum(line.approvedAmount);
      const disbursedAmount = toNum(line.disbursedAmount);
      const amortizedAmount = toNum(line.amortizedAmount);
      const debt = Math.max(disbursedAmount - amortizedAmount, 0);

      return {
        name: clean(line.name) || 'Línea financiera',
        approvedAmount,
        disbursedAmount,
        amortizedAmount,
        debt
      };
    });

    const totalDebt = normalizedCreditLines.reduce((a, x) => a + toNum(x.debt), 0);

    const cppVigenteAmount = soldVentas
      .filter(v => hasCppSignal(v))
      .reduce((a, v) => a + getMortgageAmount(v, v.__unit), 0);

    const cppTramiteAmount = soldVentas
      .filter(v => {
        const sb = norm(v.statusBanco);
        return !hasCppSignal(v) && (
          sb.includes('COMITE') ||
          sb.includes('COMITÉ') ||
          sb.includes('EVALU') ||
          sb.includes('TRAM') ||
          sb.includes('PEND') ||
          sb.includes('APROB')
        );
      })
      .reduce((a, v) => a + getMortgageAmount(v, v.__unit), 0);

    const financial = {
      creditLines: normalizedCreditLines,
      totals: {
        disbursed: normalizedCreditLines.reduce((a, x) => a + toNum(x.disbursedAmount), 0),
        amortized: normalizedCreditLines.reduce((a, x) => a + toNum(x.amortizedAmount), 0),
        debt: totalDebt
      },
      cppCoverage: {
        cppVigenteAmount,
        cppTramiteAmount,
        totalDebt,
        coverageCppVigentePct: totalDebt ? Math.round((cppVigenteAmount / totalDebt) * 10000) / 100 : 0,
        coverageCppTramitePct: totalDebt ? Math.round((cppTramiteAmount / totalDebt) * 10000) / 100 : 0
      }
    };

    // =========================
    // KPIs resumen
    // =========================
    const vals = soldVentas
      .map(v => getEffectivePrice(v, v.__unit))
      .filter(n => n > 0);

    const avgTicket = vals.length
      ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
      : 0;

    const inventoryValue = (units || [])
      .filter(u => ['disponible', 'inventario'].includes(getUnitStatus(u)))
      .reduce((acc, u) => acc + toNum(u.precioLista), 0);

    const absorption3m = (() => {
      const cutoff = now - 90 * 24 * 3600 * 1000;
      const n = soldVentas.filter(v => {
        const t = toTime(v.fechaContratoCliente);
        return t && t >= cutoff;
      }).length;
      return +(n / 3).toFixed(1);
    })();

    const permitsTotal = permitsByInstitution.reduce((a, b) =>
      a + toNum(b.approved) + toNum(b.inProcess) + toNum(b.pending) + toNum(b.rejected), 0);

    const permitsApproved = permitsByInstitution.reduce((a, b) => a + toNum(b.approved), 0);

    const kpis = {
      progressPct: progressByPhase.length
        ? Math.round(progressByPhase.reduce((a, b) => a + b.pct, 0) / progressByPhase.length)
        : 0,
      units: U,
      absorption3m,
      avgTicket,
      inventoryValue,
      loan: {
        approved: project.loanApproved || 0,
        disbursed: project.loanDisbursed || 0,
        pct: project.loanApproved
          ? Math.round(100 * (project.loanDisbursed || 0) / project.loanApproved)
          : 0
      },
      cpp: { active: cppActive, due30: cppDue30, due60: cppDue60, due90: cppDue90 },
      permits: {
        approved: permitsApproved,
        inProcess: permitsByInstitution.reduce((a, b) => a + toNum(b.inProcess), 0),
        pending: permitsByInstitution.reduce((a, b) => a + toNum(b.pending), 0),
        rejected: permitsByInstitution.reduce((a, b) => a + toNum(b.rejected), 0),
        pct: permitsTotal ? Math.round((permitsApproved / permitsTotal) * 100) : 0
      },
      appraisal: { avg: 0, min: 0, max: 0 },
      clientMortgages30d
    };

    // =========================
    // Desembolsos plan vs real
    // =========================
    const disbursements = { planCum: [], realCum: [] };

    // =========================
    // Alertas
    // =========================
    const expiries = [];

    for (const v of soldVentas) {
      if (!hasCppSignal(v)) continue;

      const d = getCppDueDate(v);
      const dt = toTime(d);
      if (!dt) continue;

      const diff = dt - now;
      if (diff <= d90) {
        expiries.push({
          type: 'CPP',
          name: `${clean(v.numCPP) || 'CPP'} — ${clean(v.banco) || ''}`,
          bank: clean(v.banco) || '',
          due: d
        });
      }
    }

    for (const d of (documents || [])) {
      if (!d.expiryDate) continue;

      const st = String(d.status || 'ACTIVE').toUpperCase();
      if (st !== 'ACTIVE') continue;

      const t = new Date(d.expiryDate).getTime() - now;
      if (t <= d90) {
        expiries.push({
          type: 'Documento',
          name: d.originalname || d.name || 'Documento',
          due: d.expiryDate,
          status: st,
          docId: d._id
        });
      }
    }

    expiries.sort((a, b) => new Date(a.due) - new Date(b.due));

    const notes = [];

    if (kpis.loan.approved && kpis.loan.disbursed < kpis.loan.approved) {
      notes.push(`Desembolsos al ${kpis.loan.pct}% del plan.`);
    }

    if (kpis.cpp.due30) {
      notes.push(`${kpis.cpp.due30} CPP vencen ≤30 días.`);
    }

    if (financial.cppCoverage.totalDebt && financial.cppCoverage.coverageCppVigentePct < 100) {
      notes.push(`Cobertura CPP vigente sobre deuda actual: ${financial.cppCoverage.coverageCppVigentePct}%.`);
    }

    if (!notes.length) notes.push('Sin riesgos destacados.');

    const today = new Date();

    const daysTo = (d) => {
      if (!d) return null;
      const dt = new Date(d);
      if (isNaN(dt.getTime())) return null;
      return Math.ceil((dt.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
    };

    const sevBucket = (diffDays) => {
      if (diffDays === null) return 'Baja';
      if (diffDays <= 7) return 'Alta';
      if (diffDays <= 30) return 'Media';
      return 'Baja';
    };

    const bySeverityCount = { Alta: 0, Media: 0, Baja: 0 };

    for (const e of expiries) {
      const diff = daysTo(e.due);
      const sev = sevBucket(diff);
      bySeverityCount[sev] = (bySeverityCount[sev] || 0) + 1;
    }

    const alertsBySeverity = [
      { severity: 'Alta', count: bySeverityCount.Alta || 0 },
      { severity: 'Media', count: bySeverityCount.Media || 0 },
      { severity: 'Baja', count: bySeverityCount.Baja || 0 }
    ];

    const delaysMap = new Map();

    for (const e of expiries) {
      const diff = daysTo(e.due);
      if (diff !== null && diff <= 0) {
        const stage = e.type || 'Otros';
        delaysMap.set(stage, (delaysMap.get(stage) || 0) + 1);
      }
    }

    const delaysByStage = Array.from(delaysMap.entries())
      .map(([stage, count]) => ({ stage, count }))
      .sort((a, b) => b.count - a.count);

    kpis.delaysByStage = delaysByStage;

    // =========================
    // Header KPIs
    // =========================
    const projectUnitsTotal = Number(project.unitsTotal || 0);
    const projectUnitsSold = Number(project.unitsSold || 0);

    const soldLikePortfolio = (units || []).reduce((n, u) => {
      return n + (isSoldLikeStatus(getUnitStatus(u)) ? 1 : 0);
    }, 0);

    const headerKpis = {
      unitsTotal: projectUnitsTotal > 0 ? projectUnitsTotal : U.total,
      unitsSold: projectUnitsSold > 0 ? projectUnitsSold : soldLikePortfolio
    };

    const projectHeader = {
      name: project.name,
      description: project.description,
      updatedAt: project.updatedAt,
      loanApproved: project.loanApproved || 0,
      loanDisbursed: project.loanDisbursed || 0,
      budgetApproved: project.budgetApproved || 0,
      budgetSpent: project.budgetSpent || 0,
      unitsTotal: headerKpis.unitsTotal,
      unitsSold: headerKpis.unitsSold
    };

    res.json({
      project: projectHeader,
      headerKpis,
      kpis,

      // Orden Bank73 / Gesproban
      commercial,
      legal,
      technical,
      financial,

      // Datasets existentes que ya usa el front
      progressByPhase,
      finance: { phases: financePhases },
      permitsByInstitution,
      cppByBank,
      proformasByBank,
      unitsByStatus,
      salesMonthly,
      disbursements,
      mortgagesByBank,
      alerts: { expiries, notes, bySeverity: alertsBySeverity },
      beforeAfter: []
    });

  } catch (e) {
    console.error('[GET /projects/:id/summary]', e);
    res.status(500).json({ error: e.message });
  }
});

// ==============================
// EXPORT RESUMEN (PDF / XLSX)
// POST /api/projects/:id/summary/export
// body: { format:'pdf'|'xlsx', charts?: { [key]: 'data:image/png;base64,...' } }
// ==============================
router.post('/:id/summary/export', requireProjectAccess(), async (req, res) => {
  try {
    const { id } = req.params;
    const tenantKey = req.tenantKey;

    const format = String(req.body?.format || 'pdf').toLowerCase();
    if (!['pdf', 'xlsx'].includes(format)) {
      return res.status(400).json({ error: 'format inválido (usa pdf o xlsx)' });
    }

    const project = await Project.findOne({ _id: id, tenantKey }).lean();
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const [checklists, documents, ventasRaw, units, permits, financePhases] = await Promise.all([
      ProjectChecklist.find({
        projectId: new mongoose.Types.ObjectId(id),
        $or: [{ tenantKey }, { tenantKey: { $exists: false } }]
      }).lean(),

      Document.find({ tenantKey, projectId: id }).sort({ createdAt: -1 }).lean(),

      Venta.find({ tenantKey, projectId: id }).lean(),

      Unit.find({ tenantKey, projectId: id, deletedAt: null }).lean(),

      (async () => {
        try {
          return await ProjectPermit.findOne({ tenantKey, projectId: id }).lean();
        } catch {
          return null;
        }
      })(),

      (async () => {
        return Array.isArray(project?.finance?.phases) ? project.finance.phases : [];
      })()
    ]);

    const norm = s => String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toUpperCase();

    const clean = s => String(s || '').trim();

    const toTime = (v) => {
      if (!v) return null;
      const t = new Date(v).getTime();
      return Number.isFinite(t) ? t : null;
    };

    const unitKey = (mz, lt) =>
      `${clean(mz).toUpperCase()}|${clean(lt).toUpperCase()}`;

    const getVentaKey = (v) => {
      const unitId = v?.unitId ? String(v.unitId) : '';
      if (unitId) return `UNIT:${unitId}`;
      return `LOT:${unitKey(v?.manzana, v?.lote)}`;
    };

    const getVentaSortTs = (v) =>
      toTime(v?.updatedAt) ||
      toTime(v?.createdAt) ||
      toTime(v?.fechaContratoCliente) ||
      0;

    const getCppDueDate = (v) =>
      v?.fechaVencimientoCPP ||
      v?.vencimientoCPP ||
      v?.vencimientoCPPBnMivi ||
      v?.vencimientoCPP_BNMIVI ||
      v?.vencimientoCPPBNMIVI ||
      null;

    const getUnitStatus = (u) => {
  const st = norm(u?.estado || u?.status);

  if (st.includes('CANCEL') || st.includes('ANUL')) return 'cancelado';

  if (st.includes('VIVIENDA_ENTREGADA') || st.includes('VIVIENDA ENTREGADA') || st.includes('ENTREG')) {
    return 'vivienda_entregada';
  }

  if (st.includes('ESCRITURADO_TRASPASADO') || st.includes('ESCRITURADO TRASPASADO') || st.includes('ESCRITURAD') || st.includes('TRASPAS')) {
    return 'escriturado_traspasado';
  }

  if (st.includes('TRAMITE_LEGAL_ACTIVADO') || st.includes('TRAMITE LEGAL ACTIVADO') || st.includes('INGRESO_RP') || st.includes('INGRESO RP')) {
    return 'tramite_legal_activado';
  }

  if (st.includes('CON_CPP') || st.includes('CON CPP') || st === 'CPP') {
    return 'con_cpp';
  }

  if (st.includes('EN_ESCRIT') || st.includes('EN ESCRIT') || st.includes('ESCRITURACION')) {
    return 'tramite_legal_activado';
  }

  if (st.includes('RESERV')) return 'reservado';

if (st.includes('INVENTARIO')) return 'inventario';

return 'disponible';
};

    const isSoldLikeStatus = (st) =>
  [
    'reservado',
    'con_cpp',
    'tramite_legal_activado',
    'escriturado_traspasado',
    'vivienda_entregada'
  ].includes(st);

    const hasCppSignal = (v) => {
      const sb = norm(v?.statusBanco);
      return (
        /CPP|APROB|CON CPP|INC/.test(sb) ||
        !!clean(v?.numCPP) ||
        !!v?.recibidoCPP ||
        !!v?.fechaValorCPP
      );
    };

    function checklistProgress(cl) {
      const subs = Array.isArray(cl?.subtasks) ? cl.subtasks : (Array.isArray(cl?.children) ? cl.children : []);
      if (!subs.length) {
        const st = norm(cl?.status);
        if (cl?.validated || /COMPLETADO|DONE/.test(st)) return 100;
        if (/EN_PROCESO|IN_PROGRESS/.test(st)) return 50;
        return 0;
      }
      const done = subs.filter(s => !!s.completed).length;
      return Math.round((done / subs.length) * 100);
    }

    const unitById = new Map((units || []).map(u => [String(u._id), u]));
    const unitByLot = new Map((units || []).map(u => [unitKey(u.manzana, u.lote), u]));

    const ventasByCurrentKey = new Map();
    for (const v of (ventasRaw || [])) {
      const key = getVentaKey(v);
      const prev = ventasByCurrentKey.get(key);
      if (!prev || getVentaSortTs(v) >= getVentaSortTs(prev)) {
        ventasByCurrentKey.set(key, v);
      }
    }

    const ventas = [];
    for (const v of ventasByCurrentKey.values()) {
      let u = null;
      if (v?.unitId) u = unitById.get(String(v.unitId)) || null;
      if (!u) u = unitByLot.get(unitKey(v?.manzana, v?.lote)) || null;
      if (!u) continue;

      ventas.push({
        ...v,
        __unit: u,
        __unitStatus: getUnitStatus(u)
      });
    }

    const LEVEL2PHASE = {
      1: 'PREESTUDIOS',
      2: 'PERMISOS',
      3: 'FINANCIACION',
      4: 'CONTRATISTAS',
      5: 'OBRA',
      6: 'ESCRITURACION'
    };

    const byLevel = new Map();
    for (const cl of (checklists || [])) {
      const lvl = Number(cl.level || 0) || 0;
      if (!LEVEL2PHASE[lvl]) continue;
      const arr = byLevel.get(lvl) || [];
      arr.push(checklistProgress(cl));
      byLevel.set(lvl, arr);
    }

    const progressByPhase = Object.entries(LEVEL2PHASE).map(([lvl, phase]) => {
      const arr = byLevel.get(Number(lvl)) || [];
      const pct = arr.length ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 0;
      return { phase, pct };
    });

    const U = {
  total: 0,
  available: 0,
inventory: 0,
reserved: 0,
  conCpp: 0,
  tramiteLegal: 0,
  escrituradas: 0,
  entregadas: 0,
  sold: 0,
  canceladas: 0
};
    for (const u of (units || [])) {
      U.total++;
      const st = getUnitStatus(u);
      if (st === 'cancelado') U.canceladas++;
else if (st === 'reservado') U.reserved++;
else if (st === 'con_cpp') U.conCpp++;
else if (st === 'tramite_legal_activado') U.tramiteLegal++;
else if (st === 'escriturado_traspasado') U.escrituradas++;
else if (st === 'vivienda_entregada') U.entregadas++;
else if (st === 'inventario') U.inventory++;
else U.available++;

if (isSoldLikeStatus(st)) U.sold++;
    }

    const now = Date.now();
    const d90 = 90 * 24 * 3600 * 1000;

    const expiries = [];

    for (const v of (ventas || [])) {
      if (!isSoldLikeStatus(v.__unitStatus)) continue;
      if (!hasCppSignal(v)) continue;

      const d = getCppDueDate(v);
      const t = toTime(d);
      if (!t) continue;

      if ((t - now) <= d90) {
        expiries.push({
          type: 'CPP',
          name: `${clean(v.numCPP) || 'CPP'} — ${clean(v.banco) || ''}`,
          due: d
        });
      }
    }

    for (const d of (documents || [])) {
      if (!d.expiryDate) continue;

      const st = String(d.status || 'ACTIVE').toUpperCase();
      if (st !== 'ACTIVE') continue;

      const t = new Date(d.expiryDate).getTime() - now;
      if (t <= d90) {
        expiries.push({
          type: 'Documento',
          name: d.originalname || d.name || 'Documento',
          due: d.expiryDate,
          status: st,
          docId: d._id
        });
      }
    }

    expiries.sort((a, b) => new Date(a.due) - new Date(b.due));

    const summary = {
      projectName: project.name || 'Proyecto',
      updatedAt: project.updatedAt,
      progressPct: progressByPhase.length
        ? Math.round(progressByPhase.reduce((a, b) => a + b.pct, 0) / progressByPhase.length)
        : 0,
      units: U,
      alerts: expiries
    };

    const safeReportFilenamePart = (value, fallback = 'Proyecto') => {
      const cleanName = String(value || fallback)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      return (cleanName || fallback).slice(0, 90);
    };

    const downloadDateStamp = (date = new Date()) => {
      const pad = n => String(n).padStart(2, '0');
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    };

    const reportFilename = (ext) =>
      `Informe Bank73 - ${safeReportFilenamePart(summary.projectName)} - ${downloadDateStamp()}.${ext}`;

    const charts = req.body?.charts && typeof req.body.charts === 'object' ? req.body.charts : {};
    const datasets = (req.body?.datasets && typeof req.body.datasets === 'object') ? req.body.datasets : {};
    const beforeAfter =
      Array.isArray(req.body?.beforeAfter) ? req.body.beforeAfter :
      Array.isArray(req.body?.datasets?.beforeAfter) ? req.body.datasets.beforeAfter :
      [];

    console.log('[EXPORT] beforeAfter len:', (beforeAfter || []).length);
    console.log('[EXPORT] beforeAfter first:', (beforeAfter || [])[0]);

    async function anyImageToBuffer(src) {
      if (!src || typeof src !== 'string') return null;

      const m = src.match(/^data:image\/\w+;base64,(.+)$/i);
      if (m) return Buffer.from(m[1], 'base64');

      if (/^https?:\/\//i.test(src)) {
        try {
          const auth = req.headers.authorization;
          const r = await axios.get(src, {
            responseType: 'arraybuffer',
            timeout: 15000,
            headers: auth ? { Authorization: auth } : undefined
          });
          return Buffer.from(r.data);
        } catch (e) {
          console.warn('[PDF] No pude descargar imagen:', src, e?.message || e);
          return null;
        }
      }

      return null;
    }

    function dataUrlToBuffer(dataUrl) {
      if (!dataUrl || typeof dataUrl !== 'string') return null;
      const m = dataUrl.match(/^data:image\/\w+;base64,(.+)$/i);
      if (!m) return null;
      return Buffer.from(m[1], 'base64');
    }

    function fmtDateTime(d) {
      try { return d ? new Date(d).toLocaleString() : '—'; } catch { return '—'; }
    }

    const BRAND_BLUE = '#123B6D';
    const BRAND_BLUE_DARK = '#0B2748';
    const BRAND_BLUE_SOFT = '#EAF2FB';
    const TEXT_DARK = '#111827';
    const TEXT_MUTED = '#64748B';

    const toNumber = (v) => {
      const n = Number(v || 0);
      return Number.isFinite(n) ? n : 0;
    };

    const fmtNum = (v) => toNumber(v).toLocaleString('es-ES');
    const fmtMoneyShort = (v) => {
      const n = toNumber(v);
      const abs = Math.abs(n);
      if (abs >= 1000000) return `$${(n / 1000000).toFixed(1)}M`;
      if (abs >= 1000) return `$${(n / 1000).toFixed(0)}k`;
      return `$${fmtNum(n)}`;
    };

    const resolveLogoPath = () => {
      const candidates = [
        path.join(process.cwd(), 'assets', 'TrustForBanksLogo.png'),
        path.join(__dirname, '..', 'assets', 'TrustForBanksLogo.png'),
        path.join(process.cwd(), 'public', 'assets', 'TrustForBanksLogo.png'),
        path.join(__dirname, '..', 'public', 'assets', 'TrustForBanksLogo.png'),
        path.join(process.cwd(), 'assets', 'Logovectorizado.png'),
        path.join(__dirname, '..', 'assets', 'Logovectorizado.png'),
      ];

      const found = candidates.find(p => fs.existsSync(p)) || null;
      if (!found) console.warn('[PDF] Logo NO encontrado. Candidatos:', candidates);
      return found;
    };

    const resolveWhiteLogoPath = () => {
      const candidates = [
        path.join(process.cwd(), 'assets', 'Bank73logoblanco.png'),
        path.join(__dirname, '..', 'assets', 'Bank73logoblanco.png'),
        path.join(process.cwd(), 'public', 'assets', 'Bank73logoblanco.png'),
        path.join(__dirname, '..', 'public', 'assets', 'Bank73logoblanco.png'),
      ];

      const found = candidates.find(p => fs.existsSync(p)) || null;
      if (!found) console.warn('[PDF] Logo blanco Bank73 NO encontrado. Candidatos:', candidates);
      return found;
    };

    function header(doc, { projectName, updatedAt }) {
      const margin = doc.page.margins.left;
      const pageW = doc.page.width;
      const logoPath = resolveLogoPath();
      const whiteLogoPath = resolveWhiteLogoPath();

      doc.save();
      doc.rect(0, 0, pageW, 30).fill(BRAND_BLUE);
      doc.restore();

      try {
        if (whiteLogoPath) doc.image(whiteLogoPath, pageW - margin - 78, 7, { width: 78 });
      } catch (err) {
        console.warn('[PDF] Error dibujando logo blanco en cabecera:', err?.message || err);
      }

      try {
        if (logoPath) doc.image(logoPath, margin, 40, { width: 96 });
      } catch (err) {
        console.warn('[PDF] Error dibujando logo:', err?.message || err);
      }

      doc
        .fontSize(16).fillColor(TEXT_DARK)
        .text('Resumen ejecutivo', margin + 118, 40, { width: pageW - margin * 2 - 118 });

      doc
        .fontSize(10).fillColor('#334155')
        .text(`Proyecto: ${projectName || 'Proyecto'}`, margin + 118, 60);

      doc
        .fontSize(9).fillColor(TEXT_MUTED)
        .text(`Actualizado: ${fmtDateTime(updatedAt)}`, margin + 118, 74);

      doc.save();
      doc.lineWidth(0.6).moveTo(margin, 92).lineTo(pageW - margin, 92).stroke('#d1d5db');
      doc.restore();

      doc.y = 106;
    }

    function roundRect(doc, x, y, w, h, r) {
      if (typeof doc.roundRect === 'function') return doc.roundRect(x, y, w, h, r);
      if (typeof doc.roundedRect === 'function') return doc.roundedRect(x, y, w, h, r);

      r = Math.min(r, w / 2, h / 2);

      doc
        .moveTo(x + r, y)
        .lineTo(x + w - r, y)
        .quadraticCurveTo(x + w, y, x + w, y + r)
        .lineTo(x + w, y + h - r)
        .quadraticCurveTo(x + w, y + h, x + w - r, y + h)
        .lineTo(x + r, y + h)
        .quadraticCurveTo(x, y + h, x, y + h - r)
        .lineTo(x, y + r)
        .quadraticCurveTo(x, y, x + r, y)
        .closePath();

      return doc;
    }

    function coverPage(doc, { projectName, updatedAt, summary }) {
      const margin = doc.page.margins.left;
      const pageW = doc.page.width;
      const pageH = doc.page.height;
      const contentW = pageW - margin * 2;

      doc.save();
      doc.rect(0, 0, pageW, 150).fill(BRAND_BLUE);
      doc.rect(0, 150, pageW, 7).fill(BRAND_BLUE_DARK);
      doc.restore();

      const logoPath = resolveLogoPath();
      if (logoPath) {
        try { doc.image(logoPath, margin, 30, { width: 118 }); } catch (_) {}
      }

      doc.fontSize(20).fillColor('white')
        .text('Resumen ejecutivo', margin + 140, 36, { width: contentW - 140 });

      doc.fontSize(12).fillColor('#EAF2FB')
        .text(projectName || 'Proyecto', margin + 140, 66, { width: contentW - 140 });

      doc.fontSize(9).fillColor('#C8D8EA')
        .text(`Actualizado: ${fmtDateTime(updatedAt)}`, margin + 140, 88, { width: contentW - 140 });

      doc.y = 180;

      const cardW = (contentW - 12) / 2;
      const cardH = 64;

      const kpis = [
        { label: 'Progreso global', value: `${summary.progressPct || 0}%` },
        { label: 'Unidades totales', value: `${summary.units?.total || 0}` },
        { label: 'Vendidas / Reservadas', value: `${summary.units?.sold || 0} / ${summary.units?.reserved || 0}` },
        { label: 'Vencimientos ≤90 días', value: `${(summary.alerts || []).length}` },
      ];

      const drawCard = (x, y, { label, value }) => {
        doc.save();
        roundRect(doc, x, y, cardW, cardH, 8).fill('#F8FAFC');
        roundRect(doc, x, y, cardW, cardH, 8).stroke('#DDE7F2');
        doc.restore();

        doc.fontSize(9).fillColor(TEXT_MUTED).text(label, x + 12, y + 10, { width: cardW - 24 });
        doc.fontSize(17).fillColor(BRAND_BLUE).text(value, x + 12, y + 29, { width: cardW - 24 });
      };

      const x1 = margin;
      const x2 = margin + cardW + 12;
      const y1 = doc.y;

      drawCard(x1, y1, kpis[0]);
      drawCard(x2, y1, kpis[1]);
      drawCard(x1, y1 + cardH + 12, kpis[2]);
      drawCard(x2, y1 + cardH + 12, kpis[3]);

      doc.y = y1 + (cardH * 2) + 30;

      const riskTop = doc.y;
      doc.save();
      roundRect(doc, margin, riskTop, contentW, 148, 8).fill('#FFFFFF').stroke('#DDE7F2');
      doc.restore();
      doc.fontSize(12).fillColor(TEXT_DARK).text('Riesgos y vencimientos', margin + 12, riskTop + 12);

      const list = (summary.alerts || []).slice(0, 8);
      if (!list.length) {
        doc.fontSize(10).fillColor(TEXT_MUTED).text('Sin vencimientos criticos.', margin + 12, riskTop + 36);
      } else {
        doc.y = riskTop + 36;
        list.forEach(a => {
          const due = a.due ? new Date(a.due).toISOString().slice(0, 10) : '—';
          doc.fontSize(9).fillColor('#334155')
            .text(`• [${a.type}] ${a.name} — ${due}`, margin + 12, doc.y, { width: contentW - 24 });
        });
      }

      doc.y = riskTop + 166;

      doc.fontSize(8).fillColor(TEXT_MUTED)
        .text('Documento confidencial para uso interno.', margin, pageH - doc.page.margins.bottom - 28, { width: contentW });
    }

    function backCoverPage(doc, { projectName }) {
      const margin = doc.page.margins.left;
      const pageW = doc.page.width;
      const pageH = doc.page.height;
      const contentW = pageW - margin * 2;
      const logoPath = resolveWhiteLogoPath();

      doc.save();
      doc.rect(0, 0, pageW, pageH).fill('#F8FAFC');
      doc.rect(0, 0, pageW, 92).fill(BRAND_BLUE);
      doc.rect(0, pageH - 72, pageW, 72).fill(BRAND_BLUE_DARK);
      doc.restore();

      if (logoPath) {
        try { doc.image(logoPath, margin, 30, { width: 120 }); } catch (_) {}
      }

      doc.fontSize(22).fillColor(BRAND_BLUE).text('Bank73', margin, 240, { width: contentW, align: 'center' });
      doc.moveDown(0.4);
      doc.fontSize(12).fillColor('#334155')
        .text('Resumen ejecutivo para seguimiento interno', margin, doc.y, { width: contentW, align: 'center' });
      doc.moveDown(0.5);
      doc.fontSize(10).fillColor(TEXT_MUTED)
        .text(projectName || 'Proyecto', margin, doc.y, { width: contentW, align: 'center' });

      doc.fontSize(8).fillColor('#EAF2FB')
        .text('Documento confidencial para uso interno.', margin, pageH - 46, { width: contentW, align: 'center' });
    }

    function coverPageV2(doc, { projectName, updatedAt, summary }) {
      const margin = doc.page.margins.left;
      const pageW = doc.page.width;
      const pageH = doc.page.height;
      const contentW = pageW - margin * 2;
      const logoPath = resolveWhiteLogoPath();

      doc.save();
      doc.rect(0, 0, pageW, pageH).fill(BRAND_BLUE);
      doc.polygon([0, pageH * 0.63], [pageW, pageH * 0.44], [pageW, pageH], [0, pageH]).fill(BRAND_BLUE_DARK);
      doc.rect(0, pageH - 90, pageW, 90).fill('#071D36');
      doc.restore();

      if (logoPath) {
        try {
          doc.image(logoPath, (pageW - 240) / 2, 54, { width: 240 });
        } catch (_) {}
      }

      doc.fontSize(31).fillColor('#FFFFFF')
        .text('Resumen ejecutivo', margin, 184, { width: contentW, align: 'center' });
      doc.fontSize(16).fillColor('#EAF2FB')
        .text(projectName || 'Proyecto', margin, 228, { width: contentW, align: 'center' });
      doc.fontSize(9).fillColor('#BFD2E8')
        .text(`Actualizado: ${fmtDateTime(updatedAt)}`, margin, 254, { width: contentW, align: 'center' });

      const panelY = 332;
      const panelH = 170;
      doc.save();
      roundRect(doc, margin, panelY, contentW, panelH, 10).fill('#FFFFFF').stroke('#DDE7F2');
      doc.restore();

      const kpiW = contentW / 4;
      [
        { label: 'Progreso', value: `${summary.progressPct || 0}%` },
        { label: 'Unidades', value: `${summary.units?.total || 0}` },
        { label: 'Vendidas', value: `${summary.units?.sold || 0}` },
        { label: 'Alertas <=90d', value: `${(summary.alerts || []).length}` },
      ].forEach((item, idx) => {
        const x = margin + (kpiW * idx);
        if (idx > 0) {
          doc.save();
          doc.lineWidth(0.5).moveTo(x, panelY + 26).lineTo(x, panelY + panelH - 26).stroke('#DDE7F2');
          doc.restore();
        }
        doc.fontSize(9).fillColor(TEXT_MUTED).text(item.label, x + 16, panelY + 42, { width: kpiW - 32, align: 'center' });
        doc.fontSize(22).fillColor(BRAND_BLUE).text(item.value, x + 16, panelY + 70, { width: kpiW - 32, align: 'center' });
      });

      doc.fontSize(10).fillColor('#334155')
        .text('Documento preparado para revision ejecutiva y seguimiento comercial, tecnico, legal y financiero.', margin + 32, panelY + 124, { width: contentW - 64, align: 'center' });

      doc.fontSize(8).fillColor('#BFD2E8')
        .text('Documento confidencial para uso interno.', margin, pageH - 62, { width: contentW, align: 'center' });
    }

    function backCoverPageV2(doc, { projectName }) {
      const margin = doc.page.margins.left;
      const pageW = doc.page.width;
      const pageH = doc.page.height;
      const contentW = pageW - margin * 2;
      const logoPath = resolveLogoPath();

      doc.save();
      doc.rect(0, 0, pageW, pageH).fill(BRAND_BLUE);
      doc.polygon([0, 0], [pageW, 0], [pageW, pageH * 0.36], [0, pageH * 0.58]).fill(BRAND_BLUE_DARK);
      doc.rect(0, pageH - 96, pageW, 96).fill('#071D36');
      doc.restore();

      if (logoPath) {
        try {
          doc.image(logoPath, (pageW - 220) / 2, 198, { width: 220 });
        } catch (_) {}
      }

      doc.fontSize(13).fillColor('#DCEBFA')
        .text('Resumen ejecutivo para seguimiento interno', margin, 326, { width: contentW, align: 'center' });
      doc.fontSize(10).fillColor('#BFD2E8')
        .text(projectName || 'Proyecto', margin, 352, { width: contentW, align: 'center' });

      doc.save();
      roundRect(doc, margin + 82, 442, contentW - 164, 74, 8).fill('#214D7C');
      doc.restore();
      doc.fontSize(9).fillColor('#EAF2FB')
        .text('Confidencial. La informacion contenida en este documento esta destinada exclusivamente a uso interno y revision autorizada.', margin + 108, 466, { width: contentW - 216, align: 'center' });

      doc.fontSize(8).fillColor('#BFD2E8')
        .text('Documento generado por Bank73 Platform', margin, pageH - 52, { width: contentW, align: 'center' });
    }

    function footer(doc, { page, total }) {
      const left = doc.page.margins.left;
      const right = doc.page.margins.right;
      const bottom = doc.page.margins.bottom;
      const pageW = doc.page.width;
      const pageH = doc.page.height;
      const y = pageH - bottom - 12;

      doc.save();
      doc.lineWidth(0.5).moveTo(left, y - 6).lineTo(pageW - right, y - 6).stroke('#DDE7F2');
      doc.fontSize(8).fillColor(TEXT_MUTED);
      doc.text('Confidencial', left, y, { align: 'left' });
      doc.text(`Página ${page}/${total}`, left, y, { align: 'right', width: pageW - left - right });
      doc.restore();
    }

    function sectionTitle(doc, title) {
      const margin = doc.page.margins.left;
      doc.moveDown(0.5);
      doc.fontSize(12).fillColor(BRAND_BLUE).text(title, margin);
      doc.moveDown(0.2);
      doc.save();
      doc.lineWidth(0.7).moveTo(margin, doc.y).lineTo(doc.page.width - margin, doc.y).stroke('#DDE7F2');
      doc.restore();
      doc.moveDown(0.6);
    }

    function buildInsights(title, datasets = {}) {
      const out = [];
      try {
        if (title === 'Ventas mensuales') {
          const sm = datasets.salesMonthly || [];
          const last = sm[sm.length - 1];
          const lastMonth = last?.month || '—';
          const lastUnits = Number(last?.units || 0);
          const last3 = sm.slice(-3).map(x => Number(x.units || 0));
          const avg3 = last3.length ? (last3.reduce((a, b) => a + b, 0) / last3.length) : 0;
          out.push(`Último mes (${lastMonth}): ${lastUnits} unidades.`);
          out.push(`Promedio 3 meses: ${avg3.toFixed(1)} u/mes.`);
        }

        if (title === 'CPP por banco') {
          const list = datasets.cppByBank || [];
          const total = list.reduce((a, x) => a + Number(x.count || 0), 0);
          const top = [...list].sort((a, b) => Number(b.count || 0) - Number(a.count || 0))[0];
          out.push(`Total CPP/APROB: ${total}.`);
          if (top) out.push(`Mayor concentración: ${top.bank} (${top.count}).`);
        }

        if (title === 'Permisos por institución') {
          const inst = datasets.permitsByInstitution || [];
          const sum = (k) => inst.reduce((a, x) => a + Number(x[k] || 0), 0);
          out.push(`Aprobados: ${sum('approved')} · Trámite: ${sum('inProcess')} · Pendientes: ${sum('pending')}.`);
          out.push(`Instituciones: ${inst.length}.`);
        }

        if (title === 'Hipotecas por banco') {
          const list = datasets.mortgagesByBank || [];
          const total = list.reduce((a, x) => a + Number(x.count || 0), 0);
          const top = [...list].sort((a, b) => Number(b.count || 0) - Number(a.count || 0))[0];
          out.push(`Total hipotecas: ${total}.`);
          if (top) out.push(`Principal banco: ${top.bank} (${top.count}).`);
        }

        if (title === 'Estado de unidades') {
          const list = datasets.unitsByStatus || [];
          const total = list.reduce((a, x) => a + Number(x.count || 0), 0);
          const top = [...list].sort((a, b) => Number(b.count || 0) - Number(a.count || 0))[0];
          out.push(`Total unidades (distribución): ${total}.`);
          if (top) out.push(`Estado dominante: ${top.status} (${top.count}).`);
        }

        if (title === 'Progreso por fase') {
          const list = datasets.progressByPhase || [];
          const top = [...list].sort((a, b) => Number(b.pct || 0) - Number(a.pct || 0))[0];
          const low = [...list].sort((a, b) => Number(a.pct || 0) - Number(b.pct || 0))[0];
          if (top) out.push(`Fase más avanzada: ${top.phase} (${top.pct}%).`);
          if (low) out.push(`Fase menos avanzada: ${low.phase} (${low.pct}%).`);
        }
      } catch (_) {}

      return out.slice(0, 3);
    }

    function chartRows(title, datasets = {}) {
      const commercialData = datasets.commercial || {};
      const legalData = datasets.legal || {};
      const technicalData = datasets.technical || {};
      const financialData = datasets.financial || {};
      const kpisData = datasets.kpis || {};
      const alertsData = datasets.alerts || {};

      const simple = (arr, labelKey, valueKey = 'count', totalLabel = 'Total', valueFmt = fmtNum) => {
        const rows = (arr || []).map(x => ({
          label: x?.[labelKey] || 'N/D',
          value: valueFmt(x?.[valueKey], x)
        }));
        const total = (arr || []).reduce((a, x) => a + toNumber(x?.[valueKey]), 0);
        return { columns: ['Concepto', 'Valor'], rows, total: { label: totalLabel, value: valueFmt(total) } };
      };

      if (title === 'Estatus lotes / unidades') return simple(datasets.unitsByStatus, 'status', 'count', 'Total unidades');
      if (title === 'Ventas mensuales') return simple(datasets.salesMonthly, 'month', 'units', 'Total ventas');
      if (title === 'CPP por banco') return simple(datasets.cppByBank, 'bank', 'count', 'Total CPP');
      if (title === 'Proformas por banco') return simple(datasets.proformasByBank, 'bank', 'count', 'Total proformas');
      if (title === 'Ventas por modelo de vivienda') return simple(commercialData.salesByModel, 'model', 'count', 'Total ventas por modelo');
      if (title === 'Perfil cliente') return simple(commercialData.clientProfile, 'profile', 'count', 'Total perfiles');
      if (title === 'Tipo de empresa') return simple(commercialData.companyType, 'type', 'count', 'Total empresas');
      if (title === 'Estatus en banco') return simple(commercialData.bankStatus, 'status', 'count', 'Total estados banco');
      if (title === 'Minutas de liberación') return simple(legalData.minutasLiberacion, 'status', 'count', 'Total minutas');
      if (title === 'Minutas de segregación') return simple(legalData.minutasSegregacion, 'status', 'count', 'Total minutas');
      if (title === 'Minutas de préstamo') return simple(legalData.minutasPrestamo, 'status', 'count', 'Total minutas');
      if (title === 'Estatus construcción') return simple(technicalData.constructionStatus, 'status', 'count', 'Total estatus');
      if (title === 'Fase de construcción') return simple(technicalData.constructionPhase, 'phase', 'count', 'Total fases');
      if (title === 'Modelos en construcción') return simple(technicalData.modelsInConstruction, 'model', 'count', 'Total modelos');
      if (title === 'Avance de construcción') return simple(technicalData.constructionProgressRanges, 'range', 'count', 'Total unidades');
      if (title === 'Alertas por severidad') return simple(alertsData.bySeverity, 'severity', 'count', 'Total alertas');
      if (title === 'Expedientes atrasados por etapa') return simple(kpisData.delaysByStage, 'stage', 'count', 'Total atrasados');

      if (title === 'Progreso por fase') {
        return {
          columns: ['Fase', '%'],
          rows: (datasets.progressByPhase || []).map(x => ({ label: x.phase || 'N/D', value: `${fmtNum(x.pct)}%` })),
          total: null
        };
      }

      if (title === 'Permisos por institución') {
        const rows = (datasets.permitsByInstitution || []).map(x => ({
          label: x.institution || 'N/D',
          value: `${fmtNum(x.approved)} aprob. · ${fmtNum(x.inProcess)} tram. · ${fmtNum(x.pending)} pend. · ${fmtNum(x.rejected)} rech.`
        }));
        const total = (datasets.permitsByInstitution || []).reduce((a, x) =>
          a + toNumber(x.approved) + toNumber(x.inProcess) + toNumber(x.pending) + toNumber(x.rejected), 0);
        return { columns: ['Institución', 'Detalle'], rows, total: { label: 'Total permisos', value: fmtNum(total) } };
      }

      if (title === 'Hipotecas por banco') {
        return {
          columns: ['Banco', 'Hipotecas / monto'],
          rows: (datasets.mortgagesByBank || []).map(x => ({ label: x.bank || 'N/D', value: `${fmtNum(x.count)} · ${fmtMoneyShort(x.amount)}` })),
          total: {
            label: 'Total hipotecas',
            value: `${fmtNum((datasets.mortgagesByBank || []).reduce((a, x) => a + toNumber(x.count), 0))} · ${fmtMoneyShort((datasets.mortgagesByBank || []).reduce((a, x) => a + toNumber(x.amount), 0))}`
          }
        };
      }

      if (title === 'Ventas vs ventas caídas') {
        const rows = (commercialData.salesVsFallenByYear || []).map(x => ({ label: x.year || 'N/D', value: `${fmtNum(x.sales)} ventas · ${fmtNum(x.fallen)} caidas` }));
        return { columns: ['Año', 'Detalle'], rows, total: { label: 'Ventas reales', value: fmtNum((commercialData.salesVsFallenByYear || []).reduce((a, x) => a + toNumber(x.sales), 0)) } };
      }

      if (title === 'Montos CPP por banco') {
        const rows = (commercialData.cppAmountByBank || []).map(x => ({ label: x.bank || 'N/D', value: `${fmtMoneyShort(x.amount)} · ${fmtNum(x.count)} CPP` }));
        return { columns: ['Banco', 'Monto / CPP'], rows, total: { label: 'Total monto CPP', value: fmtMoneyShort((commercialData.cppAmountByBank || []).reduce((a, x) => a + toNumber(x.amount), 0)) } };
      }

      if (title === 'Firma de protocolo por banco') {
        const rows = (legalData.protocolByBank || []).map(x => ({
          label: x.bank || 'N/D',
          value: `Cliente ${fmtNum(x.cliente)} · Banco cliente ${fmtNum(x.bancoCliente)} · Interino ${fmtNum(x.bancoInterino)}`
        }));
        const total = (legalData.protocolByBank || []).reduce((a, x) => a + toNumber(x.cliente) + toNumber(x.bancoCliente) + toNumber(x.bancoInterino), 0);
        return { columns: ['Banco', 'Firmas'], rows, total: { label: 'Total firmas protocolo', value: fmtNum(total) } };
      }

      if (title === 'Líneas de crédito') {
        const rows = (financialData.creditLines || []).map(x => ({ label: x.name || 'Linea financiera', value: `${fmtMoneyShort(x.debt)} deuda · ${fmtMoneyShort(x.amortizedAmount)} amort.` }));
        return { columns: ['Línea', 'Detalle'], rows, total: { label: 'Total deuda', value: fmtMoneyShort(financialData.totals?.debt) } };
      }

      if (title === 'Cobertura CPP vs préstamo') {
        const fc = financialData.cppCoverage || {};
        return {
          columns: ['Concepto', 'Monto'],
          rows: [
            { label: 'Deuda actual', value: fmtMoneyShort(fc.totalDebt) },
            { label: 'CPP vigentes', value: `${fmtMoneyShort(fc.cppVigenteAmount)} · ${fmtNum(fc.coverageCppVigentePct)}%` },
            { label: 'CPP en trámite', value: `${fmtMoneyShort(fc.cppTramiteAmount)} · ${fmtNum(fc.coverageCppTramitePct)}%` }
          ],
          total: null
        };
      }

      if (title === 'Comparación por fase') {
        const phases = datasets.finance?.phases || [];
        const sumAmount = (items) => (items || []).reduce((a, it) => a + toNumber(it?.amount), 0);
        const rows = phases.map(ph => {
          const plan = sumAmount(ph.planUses);
          const real = sumAmount(ph.uses);
          return {
            label: ph.name || ph.title || ph.phase || 'Fase',
            value: `${fmtMoneyShort(plan)} plan · ${fmtMoneyShort(real)} real`
          };
        });
        return {
          columns: ['Fase', 'Plan / real'],
          rows,
          total: {
            label: 'Total fases',
            value: `${fmtMoneyShort(phases.reduce((a, ph) => a + sumAmount(ph.planUses), 0))} plan · ${fmtMoneyShort(phases.reduce((a, ph) => a + sumAmount(ph.uses), 0))} real`
          }
        };
      }

      return null;
    }

    function drawDataTable(doc, table) {
      if (!table || !Array.isArray(table.rows) || !table.rows.length) return;

      const margin = doc.page.margins.left;
      const contentW = doc.page.width - margin * 2;
      const maxRows = 12;
      const rows = table.rows.slice(0, maxRows);
      const hidden = table.rows.length - rows.length;
      const rowH = 16;
      const headerH = 18;
      const totalH = table.total ? 18 : 0;
      const extraH = hidden > 0 ? 14 : 0;
      const tableH = headerH + rows.length * rowH + totalH + extraH;
      const leftW = Math.round(contentW * 0.42);
      const rightW = contentW - leftW;
      const x = margin;
      const y = doc.y;

      doc.save();
      roundRect(doc, x, y, contentW, tableH, 6).fill('#FFFFFF').stroke('#DDE7F2');
      doc.rect(x, y, contentW, headerH).fill(BRAND_BLUE_SOFT);
      doc.restore();

      doc.fontSize(8).fillColor(BRAND_BLUE);
      doc.text(table.columns?.[0] || 'Concepto', x + 8, y + 5, { width: leftW - 12 });
      doc.text(table.columns?.[1] || 'Valor', x + leftW, y + 5, { width: rightW - 8, align: 'right' });

      let yy = y + headerH;
      rows.forEach((r, idx) => {
        if (idx % 2 === 1) {
          doc.save();
          doc.rect(x, yy, contentW, rowH).fill('#F8FAFC');
          doc.restore();
        }
        doc.fontSize(8).fillColor('#334155');
        doc.text(String(r.label ?? 'N/D'), x + 8, yy + 4, { width: leftW - 12, ellipsis: true });
        doc.fontSize(8).fillColor(TEXT_DARK);
        doc.text(String(r.value ?? '0'), x + leftW, yy + 4, { width: rightW - 8, align: 'right', ellipsis: true });
        yy += rowH;
      });

      if (hidden > 0) {
        doc.fontSize(7).fillColor(TEXT_MUTED)
          .text(`+ ${hidden} filas adicionales no mostradas`, x + 8, yy + 3, { width: contentW - 16 });
        yy += extraH;
      }

      if (table.total) {
        doc.save();
        doc.lineWidth(0.5).moveTo(x, yy).lineTo(x + contentW, yy).stroke('#DDE7F2');
        doc.restore();
        doc.fontSize(8).fillColor(BRAND_BLUE);
        doc.text(String(table.total.label || 'Total'), x + 8, yy + 5, { width: leftW - 12 });
        doc.text(String(table.total.value || '0'), x + leftW, yy + 5, { width: rightW - 8, align: 'right' });
      }

      doc.y = y + tableH + 10;
    }

    function buildExecutiveKpis({ project, summary, datasets }) {
      const kpis = datasets?.kpis || {};
      const units = kpis.units || summary.units || {};
      const loan = kpis.loan || {};
      const cpp = kpis.cpp || {};
      const permits = kpis.permits || {};
      const mortgagesByBank = datasets?.mortgagesByBank || [];
      const proformasByBank = datasets?.proformasByBank || [];

      const top = [
        { label: 'Loan aprobado', value: fmtMoneyShort(project?.loanApproved ?? loan.approved) },
        { label: 'Desembolsado', value: fmtMoneyShort(project?.loanDisbursed ?? loan.disbursed) },
        { label: 'Budget aprobado', value: fmtMoneyShort(project?.budgetApproved) },
        { label: 'Gasto', value: fmtMoneyShort(project?.budgetSpent ?? datasets?.financial?.totals?.disbursed) },
        { label: 'Unidades totales', value: fmtNum(summary.units?.total ?? units.total) },
        { label: 'Unidades vendidas', value: fmtNum(summary.units?.sold ?? units.sold) },
      ];

      const operational = [
        { label: 'Progreso global', value: `${fmtNum(kpis.progressPct ?? summary.progressPct)}%` },
        {
          label: 'Unidades',
          value: `${fmtNum(units.total ?? summary.units?.total)} totales`,
          sub: `${fmtNum(units.available ?? summary.units?.available)} disp · ${fmtNum(units.sold ?? summary.units?.sold)} vend · ${fmtNum(units.escrituradas ?? summary.units?.escrituradas)} escr.`
        },
        { label: 'Absorción 3m', value: `${fmtNum(kpis.absorption3m)} u/mes` },
        { label: 'Ticket promedio', value: fmtMoneyShort(kpis.avgTicket) },
        { label: 'Inventario a valor', value: fmtMoneyShort(kpis.inventoryValue) },
        {
          label: 'CPP',
          value: `${fmtNum(cpp.active)} activos`,
          sub: `30d:${fmtNum(cpp.due30)} · 60d:${fmtNum(cpp.due60)} · 90d:${fmtNum(cpp.due90)}`
        },
        {
          label: 'Permisos',
          value: `${fmtNum(permits.approved)} A / ${fmtNum(permits.inProcess)} T / ${fmtNum(permits.pending)} P`,
          sub: `${fmtNum(permits.pct)}%`
        },
        { label: 'Hipotecas 30d', value: fmtNum(kpis.clientMortgages30d) },
      ];

      const commercial = [
        {
          label: 'Ventas',
          value: `${fmtNum(summary.units?.sold ?? units.sold)}/${fmtNum(summary.units?.total ?? units.total)}`,
          sub: `${summary.units?.total ? Math.round((summary.units.sold || 0) * 100 / summary.units.total) : 0}% vendido`
        },
        {
          label: 'CPP activos',
          value: fmtNum(cpp.active),
          sub: `30d:${fmtNum(cpp.due30)} · 60d:${fmtNum(cpp.due60)} · 90d:${fmtNum(cpp.due90)}`
        },
        {
          label: 'Hipotecas',
          value: fmtNum(mortgagesByBank.reduce((a, x) => a + toNumber(x.count), 0)),
          sub: `${fmtNum(mortgagesByBank.length)} bancos`
        },
        {
          label: 'Proformas',
          value: fmtNum(proformasByBank.reduce((a, x) => a + toNumber(x.count), 0)),
          sub: `${fmtNum(proformasByBank.length)} bancos`
        },
      ];

      return { top, operational, commercial };
    }

    function drawKpiGrid(doc, items, { columns = 3, tone = 'blue' } = {}) {
      const margin = doc.page.margins.left;
      const contentW = doc.page.width - margin * 2;
      const gap = 10;
      const cardW = (contentW - gap * (columns - 1)) / columns;
      const cardH = 64;
      const startY = doc.y;
      const accent = tone === 'green' ? '#0F766E' : (tone === 'purple' ? '#5B4BDB' : BRAND_BLUE);
      const pale = tone === 'green' ? '#ECFDF5' : (tone === 'purple' ? '#F1EFFE' : BRAND_BLUE_SOFT);

      items.forEach((item, idx) => {
        const col = idx % columns;
        const row = Math.floor(idx / columns);
        const x = margin + col * (cardW + gap);
        const y = startY + row * (cardH + gap);

        doc.save();
        roundRect(doc, x, y, cardW, cardH, 8).fill('#FFFFFF').stroke('#DDE7F2');
        doc.rect(x, y, 4, cardH).fill(accent);
        roundRect(doc, x + cardW - 32, y + 8, 18, 18, 9).fill(pale);
        doc.restore();

        doc.fontSize(7).fillColor(accent).text(String(item.label || '').toUpperCase(), x + 12, y + 10, { width: cardW - 50, ellipsis: true });
        doc.fontSize(16).fillColor(TEXT_DARK).text(item.value || '0', x + 12, y + 27, { width: cardW - 24, ellipsis: true });
        if (item.sub) {
          doc.fontSize(7).fillColor(TEXT_MUTED).text(item.sub, x + 12, y + 48, { width: cardW - 24, ellipsis: true });
        }
      });

      const rows = Math.ceil(items.length / columns);
      doc.y = startY + rows * (cardH + gap) + 4;
    }

    function drawKpiSection(doc, title, items, opts = {}) {
      const margin = doc.page.margins.left;
      const contentW = doc.page.width - margin * 2;
      const sectionY = doc.y;
      const columns = opts.columns || 3;
      const rows = Math.ceil(items.length / columns);
      const gridH = rows * 74 - 10;
      const sectionH = 34 + gridH + 14;

      doc.save();
      roundRect(doc, margin, sectionY, contentW, sectionH, 10).fill('#F8FAFC').stroke('#DDE7F2');
      doc.rect(margin, sectionY, contentW, 30).fill(BRAND_BLUE_SOFT);
      doc.restore();

      doc.fontSize(10).fillColor(BRAND_BLUE).text(title, margin + 14, sectionY + 9, { width: contentW - 28 });
      doc.y = sectionY + 42;
      drawKpiGrid(doc, items, { columns, tone: opts.tone || 'blue' });
      doc.y = sectionY + sectionH + 12;
    }

    function drawChart(doc, { title, dataUrl, datasets }) {
      const margin = doc.page.margins.left;

      doc.fontSize(13).fillColor(TEXT_DARK).text(title, margin);
      doc.moveDown(0.4);

      const buf = dataUrlToBuffer(dataUrl);
      if (buf) {
        const imgTop = doc.y;
        const imgH = 230;

        doc.image(buf, margin, imgTop, { fit: [doc.page.width - margin * 2, imgH], align: 'center' });
        doc.y = imgTop + imgH + 12;
      } else {
        doc.fontSize(10).fillColor(TEXT_MUTED).text('Grafica no disponible.', margin);
        doc.moveDown(0.6);
      }

      drawDataTable(doc, chartRows(title, datasets));

      const insights = buildInsights(title, datasets);
      if (insights.length) {
        doc.fontSize(10).fillColor(BRAND_BLUE).text('Notas:', margin);
        doc.moveDown(0.2);
        doc.fontSize(8).fillColor('#475569');
        insights.forEach(t => doc.text(`• ${t}`, margin));
      }

      doc.moveDown(0.6);
    }

    async function drawBeforeAfter(doc, beforeAfter, meta) {
      const margin = doc.page.margins.left;
      const items = (beforeAfter || [])
        .map(x => x?.src || x?.dataUrl || x)
        .filter(Boolean);

      if (!items.length) {
        doc.fontSize(10).fillColor('#6b7280')
          .text('No hay imágenes de Antes/Después disponibles.', margin);
        return;
      }

      const colGap = 14;
      const pageW = doc.page.width - margin * 2;
      const colW = (pageW - colGap) / 2;
      const imgH = 150;
      const cardH = imgH + 34;

      for (let i = 0; i < items.length; i += 2) {
        const left = items[i];
        const right = items[i + 1];
        const y0 = doc.y;

        if (y0 + cardH > doc.page.height - doc.page.margins.bottom - 28) {
          doc.addPage();
          header(doc, meta);
        }

        const y = doc.y;
        const drawPhotoCard = async (src, x, label) => {
          doc.save();
          roundRect(doc, x, y, colW, cardH, 8).fill('#FFFFFF').stroke('#DDE7F2');
          doc.fontSize(9).fillColor(BRAND_BLUE).text(label, x + 10, y + 9, { width: colW - 20 });
          doc.restore();

          const b = await anyImageToBuffer(src);
          if (b) {
            doc.image(b, x + 10, y + 26, { fit: [colW - 20, imgH] });
          } else {
            doc.fontSize(9).fillColor(TEXT_MUTED).text('Imagen no disponible', x + 10, y + 78, { width: colW - 20, align: 'center' });
          }
        };

        await drawPhotoCard(left, margin, `Foto ${i + 1}`);

        if (right) {
          await drawPhotoCard(right, margin + colW + colGap, `Foto ${i + 2}`);
        }

        doc.y = y + cardH + 14;
      }
    }

        const CHART_ORDER = [
      {
        section: 'Resumen Comercial',
        items: [
          'Estatus lotes / unidades',
          'Ventas mensuales',
          'Ventas vs ventas caídas',
          'Ventas por modelo de vivienda',
          'Perfil cliente',
          'Tipo de empresa',
          'Estatus en banco',
          'CPP por banco',
          'Montos CPP por banco',
          'Proformas por banco',
          'Hipotecas por banco'
        ]
      },
      {
        section: 'Resumen Legal',
        items: [
          'Minutas de liberación',
          'Minutas de segregación',
          'Minutas de préstamo',
          'Firma de protocolo por banco'
        ]
      },
      {
        section: 'Resumen Técnico',
        items: [
          'Estatus construcción',
          'Fase de construcción',
          'Modelos en construcción',
          'Avance de construcción',
          'Permisos por institución'
        ]
      },
      {
        section: 'Resumen Financiero',
        items: [
          'Comparación por fase',
          'Líneas de crédito',
          'Cobertura CPP vs préstamo'
        ]
      },
      {
        section: 'Riesgos y alertas',
        items: [
          'Alertas por severidad',
          'Expedientes atrasados por etapa'
        ]
      }
    ];

    if (format === 'xlsx') {
      const ExcelJS = require('exceljs');
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Resumen');
      ws.columns = [{ width: 28 }, { width: 60 }];
      ws.getRow(1).font = { bold: true, size: 14 };

      ws.addRow(['Proyecto', summary.projectName]);
      ws.addRow(['Actualizado', summary.updatedAt ? new Date(summary.updatedAt).toLocaleString() : '—']);
      ws.addRow([]);
      ws.addRow(['Progreso global (%)', summary.progressPct]);
      ws.addRow([]);
      ws.addRow(['Unidades', 'Cantidad']);
      ws.addRow(['Total', summary.units.total]);
      ws.addRow(['Disponibles', summary.units.available]);
      ws.addRow(['Reservadas', summary.units.reserved]);
      ws.addRow(['Con CPP', summary.units.conCpp]);
ws.addRow(['Trámite legal activado', summary.units.tramiteLegal]);
ws.addRow(['Escriturado / Traspasado', summary.units.escrituradas]);
ws.addRow(['Vivienda entregada', summary.units.entregadas]);
ws.addRow(['Vendidas / no disponibles', summary.units.sold]);
ws.addRow(['Canceladas', summary.units.canceladas]);
      ws.addRow([]);
      ws.addRow(['Vencimientos críticos (≤90d)']);
      ws.addRow(['Tipo', 'Nombre', 'Vence']);
      (summary.alerts || []).forEach(a => ws.addRow([a.type, a.name, a.due ? new Date(a.due).toISOString().slice(0, 10) : '—']));

      const wsBA = wb.addWorksheet('Antes-Después');
      wsBA.getCell('A1').value = 'Evidencia fotográfica — Antes / Después';
      wsBA.getRow(1).font = { bold: true, size: 14 };
      wsBA.columns = [{ width: 3 }, { width: 50 }, { width: 50 }];

      let rBA = 3;
      for (let i = 0; i < (beforeAfter || []).length; i += 2) {
        const left = beforeAfter[i]?.src || beforeAfter[i];
        const right = beforeAfter[i + 1]?.src || beforeAfter[i + 1];

        if (left) {
          const m1 = /^data:image\/\w+;base64,(.+)$/i.exec(String(left));
          if (m1) {
            const id1 = wb.addImage({ base64: m1[1], extension: 'png' });
            wsBA.addImage(id1, { tl: { col: 1, row: rBA }, ext: { width: 340, height: 200 } });
          }
        }

        if (right) {
          const m2 = /^data:image\/png;base64,(.+)$/i.exec(String(right));
          if (m2) {
            const id2 = wb.addImage({ base64: m2[1], extension: 'png' });
            wsBA.addImage(id2, { tl: { col: 2, row: rBA }, ext: { width: 340, height: 200 } });
          }
        }

        rBA += 12;
      }

      const keys = Object.keys(charts || {});
      if (keys.length) {
        const ws2 = wb.addWorksheet('Gráficas');
        ws2.getCell('A1').value = 'Gráficas (orden corporativo)';
        ws2.getRow(1).font = { bold: true, size: 14 };
        let row = 3;

        const orderedTitles = [];
        for (const sec of CHART_ORDER) {
          for (const t of (sec.items || [])) if (charts[t]) orderedTitles.push(t);
        }
        for (const t of keys) if (!orderedTitles.includes(t)) orderedTitles.push(t);

        for (const k of orderedTitles) {
          const dataUrl = charts[k];
          const m = /^data:image\/png;base64,(.+)$/i.exec(String(dataUrl || ''));
          if (!m) continue;

          ws2.getCell(`A${row}`).value = k;
          ws2.getRow(row).font = { bold: true };
          row += 1;

          const imgId = wb.addImage({ base64: m[1], extension: 'png' });
          ws2.addImage(imgId, { tl: { col: 0, row: row }, ext: { width: 900, height: 340 } });
          row += 20;
        }
      }

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${reportFilename('xlsx')}"`);
      await wb.xlsx.write(res);
      return res.end();
    }

    const PDFDocument = require('pdfkit');
    const doc = new PDFDocument({ margin: 40, bufferPages: true, autoFirstPage: false });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${reportFilename('pdf')}"`);
    doc.pipe(res);

    doc.addPage();
    coverPageV2(doc, { projectName: summary.projectName, updatedAt: summary.updatedAt, summary });

    doc.addPage();
    header(doc, { projectName: summary.projectName, updatedAt: summary.updatedAt });
    sectionTitle(doc, 'Resumen ejecutivo de KPIs');

    const executiveKpis = buildExecutiveKpis({ project, summary, datasets });
    drawKpiSection(doc, 'Finanzas', executiveKpis.top, { columns: 3, tone: 'blue' });
    drawKpiSection(doc, 'Operación', executiveKpis.operational, { columns: 4, tone: 'green' });
    drawKpiSection(doc, 'Comercial', executiveKpis.commercial, { columns: 4, tone: 'purple' });

    doc.addPage();
    header(doc, { projectName: summary.projectName, updatedAt: summary.updatedAt });
    sectionTitle(doc, 'Riesgos y vencimientos');

    const riskRows = (summary.alerts || []).slice(0, 10).map(a => ({
      label: `[${a.type}] ${a.name}`,
      value: a.due ? new Date(a.due).toISOString().slice(0, 10) : 'N/D'
    }));
    drawDataTable(doc, {
      columns: ['Vencimiento próximo', 'Fecha'],
      rows: riskRows.length ? riskRows : [{ label: 'Sin vencimientos criticos', value: '-' }],
      total: riskRows.length ? { label: 'Total alertas <=90 dias', value: fmtNum(riskRows.length) } : null
    });

    const noteRows = (datasets.alerts?.notes || []).map(n => ({ label: n, value: '' }));
    if (noteRows.length) {
      drawDataTable(doc, {
        columns: ['Lectura ejecutiva', ''],
        rows: noteRows,
        total: null
      });
    }

    const hasBA = Array.isArray(beforeAfter) && beforeAfter.length > 0;
    if (hasBA) {
      sectionTitle(doc, 'Evidencia fotográfica — Antes / Después');
      await drawBeforeAfter(doc, beforeAfter, {
        projectName: summary.projectName,
        updatedAt: summary.updatedAt
      });
    }

    const normKey = (s) => String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();

    function findChartKey(chartsObj, expectedTitle) {
      const expected = normKey(expectedTitle);
      const keys = Object.keys(chartsObj || {});
      let k = keys.find(x => normKey(x) === expected);
      if (k) return k;
      k = keys.find(x => normKey(x).includes(expected) || expected.includes(normKey(x)));
      return k || null;
    }

    const chartsSafe = charts || {};
    const usedKeys = new Set();

    for (const sec of CHART_ORDER) {
      const resolved = [];

      for (const expectedTitle of (sec.items || [])) {
        const realKey = findChartKey(chartsSafe, expectedTitle);
        if (realKey && chartsSafe[realKey]) {
          resolved.push({ expectedTitle, realKey });
        }
      }

      if (!resolved.length) continue;

      for (const { expectedTitle, realKey } of resolved) {
        usedKeys.add(realKey);

        doc.addPage();
        header(doc, { projectName: summary.projectName, updatedAt: summary.updatedAt });
        sectionTitle(doc, sec.section);
        drawChart(doc, { title: expectedTitle, dataUrl: chartsSafe[realKey], datasets });
      }
    }

    const leftovers = Object.keys(chartsSafe).filter(k => chartsSafe[k] && !usedKeys.has(k));

    if (leftovers.length) {
      for (const k of leftovers) {
        doc.addPage();
        header(doc, { projectName: summary.projectName, updatedAt: summary.updatedAt });
        sectionTitle(doc, 'Otras gráficas');
        drawChart(doc, { title: k, dataUrl: chartsSafe[k], datasets });
      }
    }

    doc.addPage();
    backCoverPageV2(doc, { projectName: summary.projectName });

    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      if (i === range.start || i === range.start + range.count - 1) continue;
      footer(doc, { page: i + 1, total: range.count });
    }

    doc.end();

  } catch (e) {
    console.error('[POST /projects/:id/summary/export]', e);
    res.status(500).json({ error: e.message });
  }
});

const multer = require('multer');
const XLSX = require('xlsx');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

// POST /api/projects/:id/import-dato-unico
// POST /api/projects/:id/import-dato-unico
router.post(
  '/:id/import-dato-unico',
  requireRole('admin', 'bank'),
  requireProjectAccess(),
  upload.single('file'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const tenantKey = req.tenantKey;

      if (!req.file) {
        return res.status(400).json({ error: 'Falta archivo (file)' });
      }

      const wb = XLSX.read(req.file.buffer, { type: 'buffer' });

      const sheetName =
        wb.SheetNames.find(s => String(s).trim().toUpperCase() === 'EXPEDIENTES-BANCO') ||
        wb.SheetNames[0];

      const ws = wb.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      if (rows.length < 3) {
        return res.status(400).json({ error: 'Excel vacío o formato inesperado' });
      }

      const header = rows[1].map(h => String(h || '').trim());

      const normHeader = (s) => String(s || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[º°]/g, '°')
        .replace(/\s+/g, ' ')
        .trim()
        .toUpperCase();

      const headerMap = new Map();
      for (const h of header) headerMap.set(normHeader(h), h);

      const get = (rowObj, names) => {
        for (const n of names) {
          const key = headerMap.get(normHeader(n));
          if (key && rowObj[key] !== undefined) return rowObj[key];
        }
        return '';
      };

      const clean = (v) => String(v ?? '').trim();

      const normTxt = (v) => String(v ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase();

      const asDate = (v) => {
        if (!v) return undefined;
        if (v instanceof Date && !isNaN(v)) return v;

        if (typeof v === 'number') {
          const d = XLSX.SSF.parse_date_code(v);
          if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d));
        }

        const d = new Date(v);
        return isNaN(d) ? undefined : d;
      };

      const asNum = (v) => {
        if (v === '' || v === null || v === undefined) return undefined;
        if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;

        const str = String(v).trim();
        if (!str || str.toUpperCase() === 'N/A' || str === '-') return undefined;

        const n = Number(
          str
            .replace(/\$/g, '')
            .replace(/%/g, '')
            .replace(/\s/g, '')
            .replace(/\./g, '')
            .replace(',', '.')
        );

        return Number.isFinite(n) ? n : undefined;
      };

      const toNum0 = (v) => {
        const n = asNum(v);
        return Number.isFinite(n) ? n : 0;
      };

      const parseBool = (v) => {
        const t = normTxt(v);
        if (!t || t === '-' || t === 'N/A') return false;
        if (['SI', 'S', 'YES', 'Y', 'TRUE', '1', 'X', 'OK'].includes(t)) return true;
        if (['NO', 'N', 'FALSE', '0'].includes(t)) return false;
        return false;
      };

      const calcDays = (a, b) => {
        const d1 = asDate(a);
        const d2 = asDate(b);
        if (!d1 || !d2) return undefined;
        const diff = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
        return diff >= 0 ? diff : undefined;
      };

      const idxDiasTrans = header
        .map((h, i) => normHeader(h) === 'DIAS TRANSCURRIDOS' ? i : -1)
        .filter(i => i >= 0);

      const dataRows = rows
        .slice(2)
        .filter(r => Array.isArray(r) && r.some(v => String(v ?? '').trim() !== ''))
        .filter(r => {
          const rowObj = {};
          header.forEach((h, i) => { rowObj[h] = r[i] ?? ''; });

          const lote = clean(get(rowObj, ['LOTE']));
          const manzana = clean(get(rowObj, ['MANZANA']));

          const loteRaw = normTxt(lote);
          const manzanaRaw = normTxt(manzana);

          if (!lote && !manzana) return false;
          if (loteRaw === 'TOTAL' || manzanaRaw === 'TOTAL') return false;
          if (loteRaw.startsWith('ETAPA') || manzanaRaw.startsWith('ETAPA')) return false;

          return !!(lote || manzana);
        });

      const unitKey = (mz, lt) =>
        `${clean(mz).toUpperCase()}|${clean(lt).toUpperCase()}`;

      const existingUnits = await Unit.find({
        tenantKey,
        projectId: id,
        deletedAt: null
      }).lean();

      const unitMap = new Map(
        existingUnits.map(u => [unitKey(u.manzana, u.lote), u])
      );

      let unitsUpserted = 0;
      let ventasUpserted = 0;

      const setUnitEstado = async (unitId, estadoValue) => {
        await Unit.updateOne(
          { _id: unitId },
          {
            $set: {
              estado: estadoValue,
              status: String(estadoValue || '').toUpperCase()
            }
          }
        );
      };

      const parseEstadoLibre = (raw) => {
        const t = normTxt(raw);
        if (!t) return null;

        if (t.includes('CANCEL') || t.includes('ANUL')) return 'cancelado';

        if (t.includes('NOCPP/NOCLIENTE')) return 'disponible';
        if (t.includes('NO CLIENTE')) return 'disponible';
        if (t.includes('SIN CLIENTE')) return 'disponible';
        if (t.includes('INVENTARIO')) return 'inventario';
        if (t.includes('LIBRE')) return 'disponible';
        if (t.includes('DISPON')) return 'disponible';

        if (t.includes('RESERV')) return 'reservado';

        if (t.includes('CPP/CLIENTE')) return 'con_cpp';
        if (t.includes('CON CPP')) return 'con_cpp';
        if (t === 'CPP') return 'con_cpp';

        if ((t.includes('EN') && t.includes('ESCRIT')) || t.includes('ESCRITURACION')) {
          return 'tramite_legal_activado';
        }

        if (t.includes('TRAMITE LEGAL')) return 'tramite_legal_activado';
        if (t.includes('ESCRITURAD')) return 'escriturado_traspasado';
        if (t.includes('TRASPAS')) return 'escriturado_traspasado';
        if (t.includes('ENTREG')) return 'vivienda_entregada';

        return null;
      };

      function inferEstado(rowObj, r) {
        const clienteNombre = clean(get(rowObj, ['CLIENTE', 'CLIENTE ', 'NICKNAME', 'RESUMEN CLIENTE']));
        const banco = clean(get(rowObj, ['BANCO']));
        const numCPP = clean(get(rowObj, ['N° CPP', 'Nº CPP', 'NUM CPP', 'NUMERO CPP']));
        const statusBanco = normTxt(get(rowObj, ['STATUS EN BANCO', 'STATUS  EN BANCO', 'ESTATUS BANCO']));
        const estatusLote = normTxt(get(rowObj, ['ESTATUS LOTE', 'ESTADO LOTE']));
        const estatusCtto = normTxt(get(rowObj, ['ESTATUS CTTO', 'ESTATUS CTTO ', 'ESTATUS CTTO.', 'ESTATUS CONTRATO']));

        const ingresoRP = parseBool(get(rowObj, ['INGRESO AL RP', 'INGRESO RP']));
        const fechaInscripcion = asDate(get(rowObj, ['FECHA DE INSCRIPCION', 'FECHA INSCRIPCION']));
        const entregaCasa = parseBool(get(rowObj, ['ENTREGA DE CASA', 'ENTREGA CASA']));
        const entregaANATI = parseBool(get(rowObj, ['ENTREGA ANATI']));

        const hasCliente = !!clienteNombre;
        const hasBanco = !!banco;
        const hasCpp = !!numCPP || /CPP|APROB|CON CPP|INC/.test(statusBanco);

        if (!hasCliente) {
          if (
            estatusCtto.includes('NOCPP/NOCLIENTE') ||
            estatusCtto.includes('NO CLIENTE') ||
            estatusCtto.includes('SIN CLIENTE') ||
            estatusLote.includes('INVENTARIO') ||
            estatusLote.includes('LIBRE')
          ) {
            if (estatusLote.includes('INVENTARIO')) return 'inventario';
            return 'disponible';
          }
        }

        if (entregaCasa || entregaANATI) return 'vivienda_entregada';
        if (fechaInscripcion) return 'escriturado_traspasado';
        if (estatusLote === 'TRASPASADO') return 'escriturado_traspasado';

        if (ingresoRP || hasBanco || hasCpp) {
          if (estatusLote === 'RESERVA') return 'reservado';
          if (ingresoRP) return 'tramite_legal_activado';
          if (hasCpp) return 'con_cpp';
          if (hasBanco) return 'con_cpp';
        }

        if (estatusLote) {
          if (estatusLote === 'INVENTARIO') return 'inventario';
          if (estatusLote === 'LIBRE') return 'disponible';
          if (estatusLote === 'RESERVA') return 'reservado';
          if (estatusLote === 'CON CPP') return 'con_cpp';

          const estadoLote = parseEstadoLibre(estatusLote);
          if (estadoLote) return estadoLote;
        }

        if (estatusCtto) {
          const estadoCtto = parseEstadoLibre(estatusCtto);
          if (estadoCtto) return estadoCtto;
        }

        const idxEstatus = header.findIndex(h => {
          const hh = normHeader(h);
          return hh === 'ESTATUS CTTO' || hh.startsWith('ESTATUS CTTO');
        });

        if (idxEstatus >= 0) {
          const estadoAlLado = parseEstadoLibre(r[idxEstatus + 1]);
          if (estadoAlLado) return estadoAlLado;
        }

        if (!hasCliente) return 'disponible';

        return 'reservado';
      }

      for (const r of dataRows) {
        const rowObj = {};
        header.forEach((h, i) => { rowObj[h] = r[i] ?? ''; });

        const manzana = clean(get(rowObj, ['MANZANA']));
        const lote = clean(get(rowObj, ['LOTE']));

        if (!manzana && !lote) continue;

        const uKey = unitKey(manzana, lote);
        let unit = unitMap.get(uKey);

        const estado = inferEstado(rowObj, r);

        const precioVentaExcel = toNum0(get(rowObj, [
          'PRECIO DE VENTA',
          'PRECIO VENTA',
          'PRECIO LISTA',
          'PRECIO'
        ]));

        const montoCppExcel = toNum0(get(rowObj, [
          'MONTO FINANCIAMIENTO CPP',
          'MONTO DE FINANCIAMIENTO CPP',
          'MONTO CPP',
          'VALOR CPP',
          'MONTO A FINANCIAR',
          'MONTO FINANCIAMIENTO'
        ]));

        const valorLegacyExcel = toNum0(get(rowObj, [
          'VALOR',
          'VALOR '
        ]));

        const porcentajeFinanciamientoExcel = toNum0(get(rowObj, [
          '% FINANCIAMIENTO',
          'PORCENTAJE FINANCIAMIENTO',
          'PORCENTAJE DE FINANCIAMIENTO'
        ]));

        const precioVentaFinal = precioVentaExcel > 0
          ? precioVentaExcel
          : valorLegacyExcel;

        let montoFinanciamientoCPPFinal = montoCppExcel > 0
          ? montoCppExcel
          : valorLegacyExcel;

        if (!montoFinanciamientoCPPFinal && precioVentaFinal > 0 && porcentajeFinanciamientoExcel > 0) {
          montoFinanciamientoCPPFinal = precioVentaFinal * (porcentajeFinanciamientoExcel / 100);
        }

        const porcentajeFinanciamientoFinal = precioVentaFinal > 0
          ? Number(((montoFinanciamientoCPPFinal / precioVentaFinal) * 100).toFixed(2))
          : porcentajeFinanciamientoExcel || 0;

        const abonoInicialFinal = Math.max(precioVentaFinal - montoFinanciamientoCPPFinal, 0);
        const valorLegacyFinal = montoFinanciamientoCPPFinal;
        const precioLista = precioVentaFinal;

        const areaAbiertaExcel = toNum0(get(rowObj, [
          'AREA ABIERTA',
          'ÁREA ABIERTA',
          'AREA ABIERTA VIVIENDA',
          'AREA ABIERTA VIVIENDA M2'
        ]));

        const areaCerradaExcel = toNum0(get(rowObj, [
          'AREA CERRADA',
          'ÁREA CERRADA',
          'AREA CERRADA VIVIENDA',
          'AREA CERRADA VIVIENDA M2'
        ]));

        const areaTotalConstruccionFinal =
          areaAbiertaExcel + areaCerradaExcel ||
          toNum0(get(rowObj, [
            'AREA TOTAL CONSTRUCCION',
            'ÁREA TOTAL CONSTRUCCIÓN',
            'AREA TOTAL DE CONSTRUCCION',
            'AREA TOTAL CONSTRUCCIÓN'
          ]));

        const m2UnidadFinal = toNum0(get(rowObj, [
          'M2 UNIDAD',
          'M² UNIDAD',
          'M2',
          'METROS UNIDAD',
          'AREA UNIDAD',
          'ÁREA UNIDAD'
        ]));

        const entregaExpedienteBanco = asDate(get(rowObj, [
          'ENTREGA DE EXPEDIENTE A BANCO',
          'ENTREGA EXPEDIENTE A BANCO',
          'ENTREGA EXPEDIENTE BANCO'
        ]));

        const recibidoCPP = asDate(get(rowObj, [
          'RECIBIDO DE CPP',
          'RECIBIDO CPP',
          'FECHA RECIBIDO CPP'
        ]));

        const tiempoAprobacionFinal =
          asNum(get(rowObj, ['TIEMPO DE APROBACION', 'TIEMPO APROBACION'])) ??
          calcDays(entregaExpedienteBanco, recibidoCPP);

        if (!unit) {
          unit = await Unit.create({
            tenantKey,
            projectId: id,
            manzana,
            lote,
            modelo: clean(get(rowObj, ['MODELO', 'MODELO '])),
            m2: m2UnidadFinal,
            precioLista
          });

          await setUnitEstado(unit._id, estado);

          unitMap.set(uKey, unit.toObject ? unit.toObject() : unit);
          unitsUpserted++;
        } else {
          await Unit.updateOne(
            { _id: unit._id },
            {
              $set: {
                precioLista,
                modelo: clean(get(rowObj, ['MODELO', 'MODELO '])) || unit.modelo || '',
                ...(m2UnidadFinal > 0 ? { m2: m2UnidadFinal } : {})
              }
            }
          );

          await setUnitEstado(unit._id, estado);
        }

        const payload = {
          tenantKey,
          projectId: id,
          unitId: unit._id,

          manzana,
          lote,

          // =========================
          // Cliente 1
          // =========================
          clienteNombre: clean(get(rowObj, ['CLIENTE', 'CLIENTE ', 'NICKNAME', 'RESUMEN CLIENTE', 'CLIENTE RESUMEN'])),
          cedula: clean(get(rowObj, ['CEDULA', 'CÉDULA'])),

          primerNombre: clean(get(rowObj, ['PRIMER NOMBRE'])),
          segundoNombre: clean(get(rowObj, ['SEGUNDO NOMBRE'])),
          primerApellido: clean(get(rowObj, ['APELLIDO PATERNO', 'PRIMER APELLIDO'])),
          segundoApellido: clean(get(rowObj, ['APELLIDO MATERNO', 'SEGUNDO APELLIDO'])),
          apellidoCasada: clean(get(rowObj, ['APELLIDO DE CASADA'])),

          sexo: clean(get(rowObj, ['SEXO'])),
          profesion: clean(get(rowObj, ['PROFESION', 'PROFESIÓN'])),
          estadoCivil: clean(get(rowObj, ['ESTADO CIVIL'])),
          direccion: clean(get(rowObj, ['DIRECCION', 'DIRECCIÓN', 'DIRECCION DOMICILIO', 'DIRECCIÓN DOMICILIO'])),

          telefonoResidencial: clean(get(rowObj, ['TELEFONO RESIDENCIAL', 'TELÉFONO RESIDENCIAL', 'TEL RESIDENCIAL'])),
          telefonoOficina: clean(get(rowObj, ['TELEFONO OFICINA', 'TELÉFONO OFICINA', 'TEL OFICINA'])),
          celular: clean(get(rowObj, ['CELULAR', 'TELEFONO CELULAR', 'TELÉFONO CELULAR'])),
          correo: clean(get(rowObj, ['CORREO', 'EMAIL', 'E-MAIL'])),

          perfilCliente: clean(get(rowObj, ['PERFIL CLIENTE', 'PERFIL'])),
          tipoEmpresa: clean(get(rowObj, ['TIPO EMPRESA', 'TIPO DE EMPRESA'])),
          sectorEmpresa: clean(get(rowObj, ['SECTOR EMPRESA', 'SECTOR EMPRESARIAL'])),
          ingresoMensual: asNum(get(rowObj, ['INGRESO MENSUAL', 'SALARIO', 'INGRESOS'])),
          cargo: clean(get(rowObj, ['CARGO', 'CARGO QUE DESEMPEÑA'])),
          antiguedadLaboral: clean(get(rowObj, ['ANTIGUEDAD LABORAL', 'ANTIGÜEDAD LABORAL'])),

          // =========================
          // Cliente 2
          // =========================
          cliente2PrimerNombre: clean(get(rowObj, ['CLIENTE 2 - PRIMER NOMBRE', 'CLIENTE 2 PRIMER NOMBRE', 'CO-SOLICITANTE PRIMER NOMBRE'])),
          cliente2SegundoNombre: clean(get(rowObj, ['CLIENTE 2 - SEGUNDO NOMBRE', 'CLIENTE 2 SEGUNDO NOMBRE', 'CO-SOLICITANTE SEGUNDO NOMBRE'])),
          cliente2PrimerApellido: clean(get(rowObj, ['CLIENTE 2 - APELLIDO PATERNO', 'CLIENTE 2 PRIMER APELLIDO', 'CO-SOLICITANTE PRIMER APELLIDO'])),
          cliente2SegundoApellido: clean(get(rowObj, ['CLIENTE 2 - APELLIDO MATERNO', 'CLIENTE 2 SEGUNDO APELLIDO', 'CO-SOLICITANTE SEGUNDO APELLIDO'])),
          cliente2ApellidoCasada: clean(get(rowObj, ['CLIENTE 2 - APELLIDO DE CASADA', 'CLIENTE 2 APELLIDO DE CASADA'])),
          cliente2Cedula: clean(get(rowObj, ['CLIENTE 2 - CEDULA', 'CLIENTE 2 - CÉDULA', 'CLIENTE 2 CEDULA', 'CO-SOLICITANTE CEDULA'])),

          cliente2Sexo: clean(get(rowObj, ['CLIENTE 2 - SEXO', 'CLIENTE 2 SEXO'])),
          cliente2Profesion: clean(get(rowObj, ['CLIENTE 2 - PROFESION', 'CLIENTE 2 - PROFESIÓN', 'CLIENTE 2 PROFESION'])),
          cliente2EstadoCivil: clean(get(rowObj, ['CLIENTE 2 - ESTADO CIVIL', 'CLIENTE 2 ESTADO CIVIL'])),
          cliente2Direccion: clean(get(rowObj, ['CLIENTE 2 - DIRECCION', 'CLIENTE 2 - DIRECCIÓN', 'CLIENTE 2 DIRECCION'])),

          cliente2TelefonoResidencial: clean(get(rowObj, ['CLIENTE 2 - TELEFONO RESIDENCIAL', 'CLIENTE 2 TEL RESIDENCIAL'])),
          cliente2TelefonoOficina: clean(get(rowObj, ['CLIENTE 2 - TELEFONO OFICINA', 'CLIENTE 2 TEL OFICINA'])),
          cliente2Celular: clean(get(rowObj, ['CLIENTE 2 - CELULAR', 'CLIENTE 2 CELULAR'])),
          cliente2Correo: clean(get(rowObj, ['CLIENTE 2 - CORREO', 'CLIENTE 2 EMAIL', 'CLIENTE 2 E-MAIL'])),

          cliente2IngresoMensual: asNum(get(rowObj, ['CLIENTE 2 - INGRESO MENSUAL', 'CLIENTE 2 INGRESO MENSUAL'])),
          cliente2Cargo: clean(get(rowObj, ['CLIENTE 2 - CARGO', 'CLIENTE 2 CARGO'])),
          cliente2AntiguedadLaboral: clean(get(rowObj, ['CLIENTE 2 - ANTIGUEDAD LABORAL', 'CLIENTE 2 ANTIGÜEDAD LABORAL'])),

          // =========================
          // Referencias personales
          // =========================
          referencia1Nombre: clean(get(rowObj, ['REFERENCIA 1 - NOMBRE', 'REFERENCIA 1 NOMBRE'])),
          referencia1Relacion: clean(get(rowObj, ['REFERENCIA 1 - RELACION', 'REFERENCIA 1 - RELACIÓN', 'REFERENCIA 1 RELACION'])),
          referencia1Telefono: clean(get(rowObj, ['REFERENCIA 1 - TELEFONO', 'REFERENCIA 1 - TELÉFONO', 'REFERENCIA 1 TELEFONO'])),
          referencia1TelefonoTrabajo: clean(get(rowObj, ['REFERENCIA 1 - TEL. TRABAJO', 'REFERENCIA 1 TEL TRABAJO', 'REFERENCIA 1 TELEFONO TRABAJO'])),

          referencia2Nombre: clean(get(rowObj, ['REFERENCIA 2 - NOMBRE', 'REFERENCIA 2 NOMBRE'])),
          referencia2Relacion: clean(get(rowObj, ['REFERENCIA 2 - RELACION', 'REFERENCIA 2 - RELACIÓN', 'REFERENCIA 2 RELACION'])),
          referencia2Telefono: clean(get(rowObj, ['REFERENCIA 2 - TELEFONO', 'REFERENCIA 2 - TELÉFONO', 'REFERENCIA 2 TELEFONO'])),
          referencia2TelefonoTrabajo: clean(get(rowObj, ['REFERENCIA 2 - TEL. TRABAJO', 'REFERENCIA 2 TEL TRABAJO', 'REFERENCIA 2 TELEFONO TRABAJO'])),

          // =========================
          // Unidad / inmueble
          // =========================
          numeroFinca: clean(get(rowObj, ['NUMERO DE FINCA', 'NÚMERO DE FINCA', 'FINCA'])),
          codigoUbicacion: clean(get(rowObj, ['CODIGO UBICACION', 'CÓDIGO UBICACIÓN', 'CODIGO DE UBICACION'])),
          calle: clean(get(rowObj, ['CALLE'])),

          loteEsquina: clean(get(rowObj, ['LOTE ESQUINA'])),
          metrosExtra: asNum(get(rowObj, ['M2 EXTRA', 'M² EXTRA', 'METROS EXTRA'])),
          precioLoteEsquina: asNum(get(rowObj, ['PRECIO LOTE ESQUINA', 'PRECIO LOTE ESQUINERO'])),
          precioM2Extra: asNum(get(rowObj, ['PRECIO M2 EXTRA', 'PRECIO M² EXTRA'])),

          areaAbierta: areaAbiertaExcel,
          areaCerrada: areaCerradaExcel,
          areaTotalConstruccion: areaTotalConstruccionFinal,

          recamaras: asNum(get(rowObj, ['RECAMARAS', 'RECÁMARAS', 'HABITACIONES'])),
          banos: asNum(get(rowObj, ['BANOS', 'BAÑOS'])),

          valorMejoras: asNum(get(rowObj, ['VALOR MEJORAS', 'VALOR DE MEJORAS'])),
          valorTerreno: asNum(get(rowObj, ['VALOR TERRENO', 'VALOR DE TERRENO'])),

          // =========================
          // Financiamiento / proforma
          // =========================
          banco: clean(get(rowObj, ['BANCO'])),
          oficialBanco: clean(get(rowObj, ['OFICIAL DE BANCO', 'OFICIAL BANCO'])),
          statusBanco: clean(get(rowObj, ['STATUS EN BANCO', 'STATUS  EN BANCO', 'ESTATUS BANCO'])),
          estatusCPP: clean(get(rowObj, ['ESTATUS CPP', 'STATUS CPP'])),
          numCPP: clean(get(rowObj, ['N° CPP', 'Nº CPP', 'NUM CPP', 'NUMERO CPP'])),

          precioVenta: precioVentaFinal,
          montoFinanciamientoCPP: montoFinanciamientoCPPFinal,
          porcentajeFinanciamiento: porcentajeFinanciamientoFinal,

          abonoCliente: abonoInicialFinal,
          abonoInicial: abonoInicialFinal,

          cesionAFavorDe: clean(get(rowObj, ['CESION A FAVOR DE', 'CESIÓN A FAVOR DE'])),
          fechaProbableEntrega: asDate(get(rowObj, ['FECHA PROBABLE ENTREGA', 'FECHA PROBABLE DE ENTREGA'])),

          fechaEntregaProformaBanco: asDate(get(rowObj, ['ENTREGA DE PROFORMA AL BANCO', 'FECHA ENTREGA PROFORMA BANCO'])),
          fechaProforma: asDate(get(rowObj, ['FECHA PROFORMA'])),

          entregaExpedienteBanco,
          recibidoCPP,
          plazoAprobacionDias: asNum(get(rowObj, ['PLAZO APROBACION', 'PLAZO APROBACIÓN'])),
          fechaValorCPP: asDate(get(rowObj, ['FECHA VALOR DE CPP', 'FECHA VALOR CPP'])),
          fechaVencimientoCPP: asDate(get(rowObj, [
            'FECHA DE VENCIMIENTO CPP',
            'FECHA DE VENCIMIENTO CCP',
            'VENCIMIENTO CPP'
          ])),
          vencimientoCPPBnMivi: asDate(get(rowObj, ['VENCIMIENTO CPP BN-MIVI'])),

          tiempoAprobacionDias: tiempoAprobacionFinal,

          aperturaCtaBanco: parseBool(get(rowObj, ['APERTURA CTA BANCO', 'APERTURA CUENTA BANCO'])),
          primeraMensual: parseBool(get(rowObj, ['1RA MENSUAL', 'PRIMERA MENSUAL'])),
          pagoMinuta: parseBool(get(rowObj, ['PAGO MINUTA'])),
          polizas: parseBool(get(rowObj, ['POLIZAS', 'PÓLIZAS'])),
          tipoPoliza: clean(get(rowObj, ['TIPO POLIZA', 'TIPO PÓLIZA'])),
          polizaVida: clean(get(rowObj, ['POLIZA VIDA', 'PÓLIZA VIDA', 'POLIZA DE VIDA'])),
          abonoAlte: asNum(get(rowObj, ['ABONO ALTE'])),

          valor: valorLegacyFinal,

          // =========================
          // Contrato / protocolo / notaría / RP
          // =========================
          fechaContratoCliente: asDate(get(rowObj, ['FECHA CONTRATO FIRMADO POR CLIENTE', 'FECHA CONTRATO CLIENTE'])),
          estatusContrato: clean(get(rowObj, ['ESTATUS CTTO', 'ESTATUS CONTRATO'])),
          montoContrato: asNum(get(rowObj, ['MONTO CONTRATO', 'MONTO DEL CONTRATO'])),
          pagare: clean(get(rowObj, ['PAGARE', 'PAGARÉ'])),
          fechaFirma: asDate(get(rowObj, ['FECHA FIRMA'])),
          contratoFirmado: parseBool(get(rowObj, ['CONTRATO FIRMADO'])),

          fechaActivacionTramite: asDate(get(rowObj, ['FECHA ACTIVACION TRAMITE', 'FECHA ACTIVACIÓN TRÁMITE LEGAL'])),

          protocoloFirmaCliente: parseBool(get(rowObj, ['PROTOCOLO FIRMA CLIENTE', 'PROTOCOLO FIRMA DE CLIENTE'])),
          fechaEntregaBanco: asDate(get(rowObj, ['FECHA DE ENTREGA A BANCO', 'FECHA ENTREGA BANCO'])),
          protocoloFirmaRLBancoInter: parseBool(get(rowObj, ['PROTOCOLO FIRMA RL BANCO INTER', 'PROTOC. FIRMA DE RL, BANCO INTER'])),
          fechaRegresoBanco: asDate(get(rowObj, ['FECHA REGRESO BANCO'])),
          diasTranscurridosBanco: asNum(idxDiasTrans[0] !== undefined ? r[idxDiasTrans[0]] : undefined),

          fechaEntregaProtocoloBancoCli: asDate(get(rowObj, [
            'FECHA ENTREGA PROTOCOLO BANCO CLIENTE',
            'FECHA ENTREGA PROTOCOLO BANCO CLI'
          ])),
          firmaProtocoloBancoCliente: parseBool(get(rowObj, ['FIRMA PROTOCOLO BANCO CLIENTE', 'FIRMA PROTOC. BANCO CLIENT'])),
          fechaRegresoProtocoloBancoCli: asDate(get(rowObj, [
            'FECHA REGRESO PROTOCOLO BANCO CLIENTE',
            'FECHA REGRESO PROTOCOLO BANCO CLI'
          ])),
          diasTranscurridosProtocolo: asNum(idxDiasTrans[1] !== undefined ? r[idxDiasTrans[1]] : undefined),

          pagoImpuestos: parseBool(get(rowObj, ['PAGO DE IMPUESTOS', 'PAGO IMPUESTOS'])),
          cierreNotaria: parseBool(get(rowObj, ['CIERRE DE NOTARIA'])),
          fechaPagoImpuesto: asDate(get(rowObj, ['FECHA DE PAGO DE IMPUESTO', 'FECHA PAGO IMPUESTO'])),
          ingresoRP: parseBool(get(rowObj, ['INGRESO AL RP', 'INGRESO RP'])),
          fechaIngresoRP: asDate(get(rowObj, ['FECHA INGRESO RP', 'FECHA DE INGRESO RP'])),
          fechaInscripcion: asDate(get(rowObj, ['FECHA DE INSCRIPCION', 'FECHA INSCRIPCION'])),

          solicitudDesembolso: parseBool(get(rowObj, ['SOLICITUD DE DESEMBOLSO'])),
          fechaDesembolso: asDate(get(rowObj, ['FECHA DESEMBOLSO', 'FECHA DE DESEMBOLSO'])),
          fechaRecibidoCheque: asDate(get(rowObj, ['FECHA DE RECIBIDO DE CK', 'FECHA RECIBIDO CHEQUE'])),

          // =========================
          // MIVI
          // =========================
          expedienteMIVI: clean(get(rowObj, ['EXPEDIENTE MIVI'])),
          entregaExpMIVI: asDate(get(rowObj, [
            'FECHA DE ENTREGA DE EXPEDIENTE MIVI',
            'FECHA ENTREGA EXPEDIENTE MIVI',
            'ENTREGA EXP MIVI'
          ])),
          resolucionMIVI: clean(get(rowObj, ['N° DE RESOLUCION MIVI', 'RESOLUCION MIVI', 'N° RESOLUCION MIVI'])),
          fechaResolucionMIVI: asDate(get(rowObj, ['FECHA RESOLUCION', 'FECHA RESOLUCION MIVI'])),
          solicitudMiviDesembolso: asDate(get(rowObj, ['SOLICITUD MIVI DESEMBOLSO'])),
          desembolsoMivi: clean(get(rowObj, ['DESEMBOLSO MIVI'])),
          fechaPagoMivi: asDate(get(rowObj, ['FECHA DE PAGO MIVI', 'FECHA PAGO MIVI'])),

          // =========================
          // Técnico / construcción / permisos
          // =========================
          enConstruccion: parseBool(get(rowObj, ['EN CONSTRUCCION', 'EN CONSTRUCCIÓN'])),
          estatusConstruccion: clean(get(rowObj, ['ESTATUS CONSTRUCCION', 'ESTATUS CONSTRUCCIÓN'])),
          faseConstruccion: clean(get(rowObj, ['FASE CONSTRUCCION', 'FASE CONSTRUCCIÓN'])),

          permisoConstruccionMunicipal: parseBool(get(rowObj, ['PERMISO CONSTRUCCION MUNICIPAL', 'PERMISO CONSTRUCCIÓN MUNICIPAL'])),
          permisoConstruccionNum: clean(get(rowObj, [
            'PERMISOS DE CONSTRUCCION N° RESOLUCION',
            'PERMISO DE CONSTRUCCION N° RESOLUCION',
            'PERMISOS DE CONSTRUCCION NRO RESOLUCION',
            'PERMISOS DE CONSTRUCCION Nº RESOLUCION',
            'RESOLUCION PERMISO CONSTRUCCION'
          ])),
          permisoOcupacion: parseBool(get(rowObj, ['PERMISO DE OCUPACION', 'PERMISO OCUPACION'])),
          permisoOcupacionNum: clean(get(rowObj, [
            'N° PERMISO DE OCUPACION',
            'Nº PERMISO DE OCUPACION',
            'NUMERO PERMISO DE OCUPACION',
            'RESOLUCION PERMISO OCUPACION'
          ])),
          fechaEmisionPermisoOcupacion: asDate(get(rowObj, ['FECHA EMISION PERMISO OCUPACION', 'FECHA EMISIÓN PERMISO OCUPACIÓN'])),
          constructora: clean(get(rowObj, ['CONSTUCTOR', 'CONSTRUCTOR', 'CONSTRUCTORA'])),

          // =========================
          // Legal / avalúo / minutas / paz y salvo
          // =========================
          solicitudAvaluo: clean(get(rowObj, ['SOLICITUD DE AVALUO', 'SOLICITUD AVALUO', 'SOLICITUD DE AVALÚO'])),
          avaluoRealizado: clean(get(rowObj, ['AVALUO REALIZADO', 'AVALÚO REALIZADO'])),
          fechaAvaluo: asDate(get(rowObj, ['FECHA AVALUO', 'FECHA AVALÚO'])),
          empresaAvaluadora: clean(get(rowObj, ['EMPRESA AVALUADORA'])),

          mLiberacion: clean(get(rowObj, ['M. DE LIBERACION', 'MINUTA LIBERACION', 'MINUTA LIBERACIÓN'])),
          mSegregacion: clean(get(rowObj, ['M. SEGREGACION', 'MINUTA SEGREGACION', 'MINUTA SEGREGACIÓN'])),
          mPrestamo: clean(get(rowObj, ['M. PRESTAMO', 'MINUTA PRESTAMO', 'MINUTA PRÉSTAMO'])),

          pazSalvoGesproban: parseBool(get(rowObj, ['PAZ Y SALVO GESPROBAN'])),
          pazSalvoPromotora: parseBool(get(rowObj, ['PAZ Y SALVO PROMOTORA'])),

          // =========================
          // Entrega / captación / observaciones
          // =========================
          entregaCasa: clean(get(rowObj, ['ENTREGA DE CASA', 'ENTREGA CASA'])),
          entregaANATI: clean(get(rowObj, ['ENTREGA ANATI'])),
          fechaEntregaVivienda: asDate(get(rowObj, ['FECHA ENTREGA VIVIENDA', 'FECHA DE ENTREGA VIVIENDA'])),

          captadoAtencionOficina: parseBool(get(rowObj, ['CAPTADO ATENCION OFICINA', 'CAPTADO ATENCIÓN OFICINA'])),
          captadoMailInternet: parseBool(get(rowObj, ['CAPTADO MAIL INTERNET', 'CAPTADO MAIL / INTERNET'])),
          captadoEnProyecto: parseBool(get(rowObj, ['CAPTADO EN PROYECTO'])),
          captadoMercadeoProspecto: parseBool(get(rowObj, ['CAPTADO MERCADEO PROSPECTO', 'CAPTADO MERCADEO / PROSPECTO'])),

          proformaSolicitadaPor: clean(get(rowObj, ['PROFORMA SOLICITADA POR'])),
          referidoPor: clean(get(rowObj, ['REFERIDO POR'])),
          observacionCliente: clean(get(rowObj, ['OBSERVACION CLIENTE', 'OBSERVACIÓN CLIENTE'])),
          comentario: clean(get(rowObj, ['COMENTARIO', 'COMENTARIO INTERNO']))
        };

        await Venta.findOneAndUpdate(
          { tenantKey, projectId: id, unitId: unit._id },
          { $set: payload },
          { upsert: true, new: true, runValidators: true }
        );

        ventasUpserted++;
      }

      const [unitsForProject, ventasForProject, unitsTotal, unitsSold] = await Promise.all([
        Unit.find({ tenantKey, projectId: id, deletedAt: null }).lean(),
        Venta.find({ tenantKey, projectId: id }).lean(),
        Unit.countDocuments({ tenantKey, projectId: id, deletedAt: null }),
        Unit.countDocuments({
          tenantKey,
          projectId: id,
          deletedAt: null,
          $or: [
            {
              estado: {
                $in: [
                  'reservado',
                  'con_cpp',
                  'tramite_legal_activado',
                  'escriturado_traspasado',
                  'vivienda_entregada'
                ]
              }
            },
            {
              status: {
                $in: [
                  'RESERVADO',
                  'CON_CPP',
                  'TRAMITE_LEGAL_ACTIVADO',
                  'ESCRITURADO_TRASPASADO',
                  'VIVIENDA_ENTREGADA'
                ]
              }
            }
          ]
        })
      ]);

      const unitById2 = new Map((unitsForProject || []).map(u => [String(u._id), u]));

      const soldVals = (ventasForProject || [])
        .map(v => {
          const vvPrecio = toNum0(v.precioVenta);
          if (vvPrecio > 0) return vvPrecio;

          const u = unitById2.get(String(v.unitId));
          const unitPrecio = toNum0(u?.precioLista);
          if (unitPrecio > 0) return unitPrecio;

          return toNum0(v.valor);
        })
        .filter(n => n > 0);

      const ticketPromedio = soldVals.length
        ? Math.round(soldVals.reduce((a, b) => a + b, 0) / soldVals.length)
        : 0;

      const valorTotalVentas = soldVals.reduce((a, b) => a + b, 0);

      const p = await Project.findOne({ _id: id, tenantKey });

      if (p) {
        const FIELD_CANDIDATES = {
          unitsTotal: ['unitsTotal', 'unidadesTotales', 'unidades_totales'],
          unitsSold: ['unitsSold', 'unidadesVendidas', 'unidades_vendidas'],
          ticketPromedio: ['ticketPromedio', 'ticket_promedio', 'avgTicket', 'averageTicket'],
          valorVentas: ['valorVentas', 'ventasTotal', 'totalVentas', 'ventas_total'],
        };

        const pickExistingField = (cands) => {
          const obj = p.toObject?.() || p;
          for (const f of cands) if (f in obj) return f;
          return cands[0];
        };

        const setNum = (logicalKey, value) => {
          const field = pickExistingField(FIELD_CANDIDATES[logicalKey]);
          p.set(field, Number(value || 0));
        };

        setNum('unitsTotal', unitsTotal);
        setNum('unitsSold', unitsSold);
        setNum('ticketPromedio', ticketPromedio);
        setNum('valorVentas', valorTotalVentas);

        await p.save();
      }

      res.json({
        ok: true,
        sheet: sheetName,
        rows: dataRows.length,
        unitsUpserted,
        ventasUpserted,
        kpisProyecto: {
          unitsTotal,
          unitsSold,
          ticketPromedio,
          valorTotalVentas
        }
      });

    } catch (e) {
      console.error('[IMPORT DATO UNICO]', e);
      res.status(500).json({ error: e.message });
    }
  }
);

module.exports = router;
