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
    // Mantén tu lógica actual de visibilidad/tenant/estado:
    const q = buildPortfolioQuery(req);

    // 1) Trae los proyectos visibles
    const projects = await Project.find(q).sort({ updatedAt: -1 }).lean();
    if (!projects.length) return res.json([]);

    const pids = projects.map(p => p._id);

    // 2) Define qué estados cuentan como "vendido" en la barra
    const SOLD_ESTADOS = ['reservado','en_escrituracion','escriturado','entregado'];

    // 3) Agrega unidades por proyecto
    const agg = await Unit.aggregate([
      { $match: { tenantKey: req.tenantKey, projectId: { $in: pids }, deletedAt: null } },
      {
        $group: {
          _id: '$projectId',
          total: { $sum: 1 },
          sold: {
            $sum: {
              $cond: [
                { $in: [ { $toLower: { $ifNull: ['$estado', '$status'] } }, SOLD_ESTADOS ] },
                1,
                0
              ]
            }
          }
        }
      }
    ]);

    const byProject = new Map(agg.map(a => [String(a._id), a]));

    // 4) Respuesta lista para el portfolio
    const out = projects.map(p => {
      const m = byProject.get(String(p._id));
      return {
        _id: p._id,
        name: p.name,
        description: p.description,
        status: p.status,
        // si ya guardas unitsTotal en Project lo respetamos; si no, usamos el agregado
        unitsTotal: p.unitsTotal ?? m?.total ?? 0,
        unitsSold:  m?.sold ?? 0,
      };
    });

    res.json(out);
  } catch (e) {
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

    // Se mantienen requerimientos actuales
    const promotersRaw   = Array.isArray(body.assignedPromoters)   ? body.assignedPromoters   : [];
    const commercialsRaw = Array.isArray(body.assignedCommercials) ? body.assignedCommercials : [];

    const validPromoters   = await validateAssignees({ tenantKey, role:'promoter',   ids: promotersRaw });
    const validCommercials = await validateAssignees({ tenantKey, role:'commercial', ids: commercialsRaw });

    if (validPromoters.length === 0) {
      return res.status(400).json({ error: 'Debes asignar al menos un promotor activo del tenant.' });
    }

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
    res.json({ ok: true, project: updated });
  } catch (err) {
    console.error('[PUT /api/projects/:id]', err);
    res.status(500).json({ error: 'Error actualizando el proyecto' });
  }
});

router.delete('/:id', requireRole('admin','bank'), async (req, res) => {
  const del = await Project.findOneAndDelete({ _id: req.params.id, tenantKey: req.tenantKey });
  if (!del) return res.status(404).json({ error: 'Proyecto no encontrado' });
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
    res.json({ ok: true, project: proj });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


router.get('/:id/summary', requireProjectAccess(), async (req, res) => {
  const { id } = req.params;
  const tenantKey = req.tenantKey;
  const project = await Project.findOne({ _id: id, tenantKey }).lean();
  // ✅ fases de finanzas (si están embebidas en Project)
const financePhases = Array.isArray(project?.finance?.phases) ? project.finance.phases : [];

  if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

  // === Cargas base ===
  const [checklists, documents, ventas, units, permits] = await Promise.all([
    ProjectChecklist.find({
      projectId: new mongoose.Types.ObjectId(id),
      $or: [{ tenantKey }, { tenantKey: { $exists: false } }]
    }).lean(),
    Document.find({ tenantKey, projectId: id }).sort({ createdAt: -1 }).lean(),
    Venta.find({ tenantKey, projectId: id }).lean(),
    // importante: no contar unidades borradas
    Unit.find({ tenantKey, projectId: id, deletedAt: null }).lean(),
    (async () => {
  try {
    return await ProjectPermit.findOne({ tenantKey, projectId: id }).lean();
  } catch {
    return null;
  }
})()
  ]);

  // === Helpers ===
  const norm = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();

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

  // === Progreso por fase (por level 1..6) ===
  const LEVEL2PHASE = {
    1:'PREESTUDIOS', 2:'PERMISOS', 3:'FINANCIACION',
    4:'CONTRATISTAS', 5:'OBRA', 6:'ESCRITURACION'
  };
  const byLevel = new Map();
  for (const cl of (checklists||[])) {
    const lvl = Number(cl.level||0) || 0;
    if (!LEVEL2PHASE[lvl]) continue;
    const arr = byLevel.get(lvl) || [];
    arr.push(checklistProgress(cl));
    byLevel.set(lvl, arr);
  }
  const progressByPhase = Object.entries(LEVEL2PHASE).map(([lvl, phase]) => {
    const arr = byLevel.get(Number(lvl)) || [];
    const pct = arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : 0;
    return { phase, pct };
  });

  // === KPIs de unidades ===
  const SOLD   = ['reservado','vendido','en_escrituracion','escriturado','entregado'];
  const CANCEL = ['cancelado','anulado'];
  const U = { total:0, available:0, reserved:0, sold:0, escrituradas:0, canceladas:0 };
  for (const u of (units||[])) {
    U.total++;
    const st = norm(u.estado||u.status);
    if (CANCEL.includes(st.toLowerCase())) U.canceladas++;
    else if (st.includes('ESCRIT')) U.escrituradas++;
    else if (st.includes('RESERV')) U.reserved++;
    else if (SOLD.includes(st.toLowerCase())) U.sold++;
    else U.available++;
  }
  const unitsByStatus = [
    { status:'Disponible',  count: U.available },
    { status:'Reservada',   count: U.reserved },
    { status:'Vendida',     count: U.sold },
    { status:'Escriturada', count: U.escrituradas },
    { status:'Cancelada',   count: U.canceladas }
  ];

  // === Ventas mensuales (por fechaContratoCliente) ===
  const salesMap = new Map();
  for (const v of (ventas||[])) {
    const d = v.fechaContratoCliente ? new Date(v.fechaContratoCliente) : null;
    if (!d) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    salesMap.set(key, (salesMap.get(key)||0)+1);
  }
  const salesMonthly = Array.from(salesMap.entries())
    .sort((a,b)=>a[0].localeCompare(b[0]))
    .map(([month, units]) => ({ month, units }));

  // === CPP por banco (robusto aunque no haya numCPP) ===
  const now = Date.now(), d30 = 30*24*3600*1000, d60 = 60*24*3600*1000, d90 = 90*24*3600*1000;
  const cppByBankMap = new Map();
  let cppDue30=0, cppDue60=0, cppDue90=0, cppActive=0;

  for (const v of (ventas||[])) {
    const bank = (v.banco || 'Sin banco').toString();
    const sb = norm(v.statusBanco);
    const hasCPPFlag = /CPP|APROB/.test(sb) || !!v.numCPP || !!v.recibidoCPP || !!v.fechaValorCPP;
    if (!hasCPPFlag) continue;

    cppActive++;
    cppByBankMap.set(bank, (cppByBankMap.get(bank)||0) + 1);

    const venc = v.vencimientoCPP || v.vencimientoCPP_BNMIVI || v.vencimientoCPPBNMIVI;
    if (venc) {
      const t = new Date(venc).getTime() - now;
      if (t <= d30) cppDue30++;
      else if (t <= d60) cppDue60++;
      else if (t <= d90) cppDue90++;
    }
  }
  const cppByBank = Array.from(cppByBankMap.entries())
    .map(([bank, count]) => ({ bank, count }))
    .sort((a,b)=>b.count-a.count);

  // === Proformas por banco (statusBanco que contenga 'PROFORMA') ===
  const profMap = new Map();
  for (const v of (ventas||[])) {
    if (!/PROFORMA/.test(norm(v.statusBanco))) continue;
    const bank = (v.banco || 'Sin banco').toString();
    profMap.set(bank, (profMap.get(bank)||0)+1);
  }
  const proformasByBank = Array.from(profMap.entries())
    .map(([bank, count]) => ({ bank, count }))
    .sort((a,b)=>b.count-a.count);

  // === Hipotecas por banco (aprobadas) ===
  const mortMap = new Map();
  let clientMortgages30d = 0;
  for (const v of (ventas||[])) {
    const approved = /APROB/.test(norm(v.statusBanco));
    if (!approved) continue;
    const bank = (v.banco || 'Sin banco').toString();
    mortMap.set(bank, (mortMap.get(bank)||0)+1);
    const fd = v.updatedAt || v.fechaValorCPP || v.recibidoCPP || v.fechaContratoCliente;
    if (fd && (now - new Date(fd).getTime()) <= d30) clientMortgages30d++;
  }
  const mortgagesByBank = Array.from(mortMap.entries())
    .map(([bank, count]) => ({ bank, count }))
    .sort((a,b)=>b.count-a.count);

  // === Permisos por institución/estado (desde ProjectPermit.items) ===
const byInst = {};
const permitItems = Array.isArray(permits?.items) ? permits.items : [];

const normSt = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita tildes
  .trim()
  .toUpperCase();


for (const it of permitItems) {
  const inst = String(it.institution || 'N/D').trim() || 'N/D';
  const st = normSt(it.status);

  byInst[inst] ||= { institution: inst, approved: 0, inProcess: 0, pending: 0 };

  if (st === 'APPROVED' || st === 'APROBADO' || /APROB/.test(st)) byInst[inst].approved++;
  else if (
  st === 'IN_PROCESS' ||
  st === 'EN_TRAMITE' ||
  st === 'EN TRAMITE' ||
  st === 'TRAMITE' ||
  /TRAM|PROC|EN PROCESO/.test(st)
) {
  byInst[inst].inProcess++;
}
  else byInst[inst].pending++;
}

const permitsByInstitution = Object.values(byInst)
  .sort((a,b) => (b.approved+b.inProcess+b.pending) - (a.approved+a.inProcess+a.pending));

  // === KPIs resumen ===
  const vals = (ventas||[]).map(v => Number(v.valor)||0).filter(n=>n>0);
  const avgTicket = vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : 0;
  const absorption3m = (() => {
    const cutoff = now - 90*24*3600*1000;
    const n = (ventas||[]).filter(v => v.fechaContratoCliente && new Date(v.fechaContratoCliente).getTime() >= cutoff).length;
    return +(n/3).toFixed(1);
  })();
  const kpis = {
    progressPct: progressByPhase.length ? Math.round(progressByPhase.reduce((a,b)=>a+b.pct,0)/progressByPhase.length) : 0,
    units: U,
    absorption3m,
    avgTicket,
    inventoryValue: 0,
    loan: {
      approved: project.loanApproved||0,
      disbursed: project.loanDisbursed||0,
      pct: project.loanApproved ? Math.round(100*(project.loanDisbursed||0)/project.loanApproved) : 0
    },
    cpp: { active: cppActive, due30: cppDue30, due60: cppDue60, due90: cppDue90 },
    permits: {
      approved: permitsByInstitution.reduce((a,b)=>a+(b.approved||0),0),
      inProcess: permitsByInstitution.reduce((a,b)=>a+(b.inProcess||0),0),
      pending: permitsByInstitution.reduce((a,b)=>a+(b.pending||0),0),
      pct: permitsByInstitution.length
        ? Math.round(100 * permitsByInstitution.reduce((a,b)=>a+(b.approved||0),0) /
                     permitsByInstitution.reduce((a,b)=>a+((b.approved||0)+(b.inProcess||0)+(b.pending||0)),0))
        : 0
    },
    appraisal: { avg: 0, min: 0, max: 0 },
    clientMortgages30d
  };

  // === Desembolsos plan vs real (si no tienes, devolvemos vacío) ===
  const disbursements = { planCum: [], realCum: [] };

  // === Alertas (CPP por vencer + documentos por vencer) ===
  const expiries = [];
  for (const v of (ventas||[])) {
    const d = v.vencimientoCPP || v.vencimientoCPP_BNMIVI || v.vencimientoCPPBNMIVI;
    if (!d) continue;
    const t = new Date(d).getTime() - now;
    if (t <= d90) expiries.push({ type:'CPP', name:`${v.numCPP||'CPP'} — ${v.banco||''}`, bank: v.banco||'', due: d });
  }
  for (const d of (documents||[])) {
    if (!d.expiryDate) continue;
    const t = new Date(d.expiryDate).getTime() - now;
    if (t <= d90) expiries.push({ type:'Documento', name: d.originalname || d.name || 'Documento', due: d.expiryDate });
  }
  expiries.sort((a,b)=> new Date(a.due) - new Date(b.due));
  const notes = [];
  if (kpis.loan.approved && kpis.loan.disbursed < kpis.loan.approved)
    notes.push(`Desembolsos al ${kpis.loan.pct}% del plan.`);
  if (kpis.cpp.due30) notes.push(`${kpis.cpp.due30} CPP vencen ≤30 días.`);
  if (!notes.length) notes.push('Sin riesgos destacados.');

  // ✅ NUEVO: headerKpis y projectHeader con prioridad al Project (lo importado),
  // y fallback al cálculo actual si no existe en schema o está en 0.
  const projectUnitsTotal = Number(project.unitsTotal || 0);
  const projectUnitsSold  = Number(project.unitsSold || 0);

  const SOLD_PORT = ['reservado','en_escrituracion','escriturado','entregado'];
  const soldLikePortfolio = (units || []).reduce((n, u) => {
    const st = String(u.estado || u.status || '').toLowerCase();
    return n + (SOLD_PORT.includes(st) ? 1 : 0);
  }, 0);

  const headerKpis = {
    unitsTotal: projectUnitsTotal > 0 ? projectUnitsTotal : U.total,
    unitsSold:  projectUnitsSold  > 0 ? projectUnitsSold  : soldLikePortfolio
  };

  const projectHeader = {
    name: project.name,
    updatedAt: project.updatedAt,
    loanApproved:   project.loanApproved   || 0,
    loanDisbursed:  project.loanDisbursed  || 0,
    budgetApproved: project.budgetApproved || 0,
    budgetSpent:    project.budgetSpent    || 0,
    // 👇 ESTO ES LO QUE TE FALTABA ARRIBA
    unitsTotal: headerKpis.unitsTotal,
    unitsSold:  headerKpis.unitsSold
  };

  // ====== EXTRA KPIs para nuevas gráficas del Resumen ======
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

  for (const e of (expiries || [])) {
    const diff = daysTo(e.due);
    const sev = sevBucket(diff);
    bySeverityCount[sev] = (bySeverityCount[sev] || 0) + 1;
  }

  const alertsBySeverity = [
    { severity: 'Alta',  count: bySeverityCount.Alta  || 0 },
    { severity: 'Media', count: bySeverityCount.Media || 0 },
    { severity: 'Baja',  count: bySeverityCount.Baja  || 0 },
  ];

  const delaysMap = new Map();
  for (const e of (expiries || [])) {
    const diff = daysTo(e.due);
    if (diff !== null && diff <= 0) {
      const stage = (e.type || 'Otros');
      delaysMap.set(stage, (delaysMap.get(stage) || 0) + 1);
    }
  }

  const delaysByStage = Array.from(delaysMap.entries())
    .map(([stage, count]) => ({ stage, count }))
    .sort((a, b) => b.count - a.count);

  kpis.delaysByStage = delaysByStage;

  // === Respuesta ===
  res.json({
    project: projectHeader,     // <- ahora ya trae unitsTotal/unitsSold para la cabecera
    headerKpis,                 // <- consistente con Project si lo importaste
    kpis,
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
    if (!['pdf','xlsx'].includes(format)) {
      return res.status(400).json({ error: 'format inválido (usa pdf o xlsx)' });
    }

    // Reusamos TU MISMA data del summary
    // (si prefieres, puedes “refactorizar” y extraer a una función, pero así rápido funciona)
    // -> llamamos internamente a la lógica del summary replicándola con Promise.all
    const project = await Project.findOne({ _id: id, tenantKey }).lean();
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    // === Cargas base ===
const [checklists, documents, ventas, units, permits, financePhases] = await Promise.all([
  ProjectChecklist.find({
    projectId: new mongoose.Types.ObjectId(id),
    $or: [{ tenantKey }, { tenantKey: { $exists: false } }]
  }).lean(),

  Document.find({ tenantKey, projectId: id }).sort({ createdAt: -1 }).lean(),

  Venta.find({ tenantKey, projectId: id }).lean(),

  Unit.find({ tenantKey, projectId: id, deletedAt: null }).lean(),

  // Permisos (igual que en summary)
(async () => {
  try {
    return await ProjectPermit.findOne({ tenantKey, projectId: id }).lean();
  } catch {
    return null;
  }
})(),

  // Fases finanzas
  (async () => {
    // Si no las usas aún, devuelve vacío para no romper nada
    return [];
  })()

]);

    // ===== helpers (idénticos a tu summary) =====
    const norm = s => String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase();
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

    const LEVEL2PHASE = { 1:'PREESTUDIOS', 2:'PERMISOS', 3:'FINANCIACION', 4:'CONTRATISTAS', 5:'OBRA', 6:'ESCRITURACION' };
    const byLevel = new Map();
    for (const cl of (checklists||[])) {
      const lvl = Number(cl.level||0) || 0;
      if (!LEVEL2PHASE[lvl]) continue;
      const arr = byLevel.get(lvl) || [];
      arr.push(checklistProgress(cl));
      byLevel.set(lvl, arr);
    }
    const progressByPhase = Object.entries(LEVEL2PHASE).map(([lvl, phase]) => {
      const arr = byLevel.get(Number(lvl)) || [];
      const pct = arr.length ? Math.round(arr.reduce((a,b)=>a+b,0)/arr.length) : 0;
      return { phase, pct };
    });

    const SOLD = ['reservado','vendido','en_escrituracion','escriturado','entregado'];
    const CANCEL = ['cancelado','anulado'];
    const U = { total:0, available:0, reserved:0, sold:0, escrituradas:0, canceladas:0 };
    for (const u of (units||[])) {
      U.total++;
      const st = norm(u.estado||u.status);
      if (CANCEL.includes(st.toLowerCase())) U.canceladas++;
      else if (st.includes('ESCRIT')) U.escrituradas++;
      else if (st.includes('RESERV')) U.reserved++;
      else if (SOLD.includes(st.toLowerCase())) U.sold++;
      else U.available++;
    }

    const now = Date.now(), d90 = 90*24*3600*1000;
    const expiries = [];
    for (const v of (ventas||[])) {
      const d = v.vencimientoCPP || v.vencimientoCPP_BNMIVI || v.vencimientoCPPBNMIVI;
      if (!d) continue;
      const t = new Date(d).getTime() - now;
      if (t <= d90) expiries.push({ type:'CPP', name:`${v.numCPP||'CPP'} — ${v.banco||''}`, due: d });
    }
    for (const d of (documents||[])) {
      if (!d.expiryDate) continue;
      const t = new Date(d.expiryDate).getTime() - now;
      if (t <= d90) expiries.push({ type:'Documento', name: d.originalname || d.name || 'Documento', due: d.expiryDate });
    }
    expiries.sort((a,b)=> new Date(a.due) - new Date(b.due));

    const summary = {
      projectName: project.name || 'Proyecto',
      updatedAt: project.updatedAt,
      progressPct: progressByPhase.length ? Math.round(progressByPhase.reduce((a,b)=>a+b.pct,0)/progressByPhase.length) : 0,
      units: U,
      alerts: expiries
    };

    // Charts opcionales (desde front)
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

  // dataURL base64
  const m = src.match(/^data:image\/\w+;base64,(.+)$/i);
  if (m) return Buffer.from(m[1], 'base64');

  // URL http(s)
  if (/^https?:\/\//i.test(src)) {
    try {
      const auth = req.headers.authorization; // ✅ coge el token del usuario
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

const resolveLogoPath = () => {
  const candidates = [
    path.join(process.cwd(), 'assets', 'TrustForBanksLogo.png'),
    path.join(__dirname, '..', 'assets', 'TrustForBanksLogo.png'),

    path.join(process.cwd(), 'public', 'assets', 'TrustForBanksLogo.png'),
    path.join(__dirname, '..', 'public', 'assets', 'TrustForBanksLogo.png'),

    // fallback por si el nombre real difiere
    path.join(process.cwd(), 'assets', 'Logovectorizado.png'),
    path.join(__dirname, '..', 'assets', 'Logovectorizado.png'),
  ];

  const found = candidates.find(p => fs.existsSync(p)) || null;

  // 🔥 DEBUG útil (quítalo cuando ya funcione)
  if (!found) console.warn('[PDF] Logo NO encontrado. Candidatos:', candidates);

  return found;
};

function header(doc, { projectName, updatedAt }) {
  const margin = doc.page.margins.left;
  const pageW = doc.page.width;

  const logoPath = resolveLogoPath();

  // logo (si existe)
  try {
    if (logoPath) doc.image(logoPath, margin, 18, { width: 120 });
  } catch (err) {
    console.warn('[PDF] Error dibujando logo:', err?.message || err);
  }

  doc
    .fontSize(16).fillColor('#111827')
    .text('Resumen ejecutivo', margin + 140, 22, { width: pageW - margin*2 - 140 });

  doc
    .fontSize(10).fillColor('#374151')
    .text(`Proyecto: ${projectName || 'Proyecto'}`, margin + 140, 42);

  doc
    .fontSize(9).fillColor('#6b7280')
    .text(`Actualizado: ${fmtDateTime(updatedAt)}`, margin + 140, 56);

  doc.save();
  doc.lineWidth(0.5).moveTo(margin, 74).lineTo(pageW - margin, 74).stroke('#d1d5db');
  doc.restore();

  doc.y = 88;
}

function roundRect(doc, x, y, w, h, r) {
  // Compat: si tu pdfkit sí tuviera roundedRect, úsalo
  if (typeof doc.roundRect === 'function') return doc.roundRect(x, y, w, h, r);
  if (typeof doc.roundedRect === 'function') return doc.roundedRect(x, y, w, h, r);

  // Fallback manual (funciona en cualquier pdfkit)
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
  const contentW = pageW - margin*2;

  // Banda superior (corporativa)
  doc.save();
  doc.rect(0, 0, pageW, 110).fill('#0B3B2E'); // verde oscuro
  doc.restore();

  // Logo + título en blanco
  const logoPath = resolveLogoPath();
  if (logoPath) {
    try { doc.image(logoPath, margin, 22, { width: 120 }); } catch (_) {}
  }

  doc.fontSize(20).fillColor('white')
    .text('Resumen ejecutivo', margin + 140, 28, { width: contentW - 140 });

  doc.fontSize(11).fillColor('#D1FAE5')
    .text(projectName || 'Proyecto', margin + 140, 58, { width: contentW - 140 });

  doc.fontSize(9).fillColor('#A7F3D0')
    .text(`Actualizado: ${fmtDateTime(updatedAt)}`, margin + 140, 78, { width: contentW - 140 });

  // Área blanca principal
  doc.y = 130;

  // KPI cards (2x2)
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
    roundRect(doc, x, y, cardW, cardH, 10).fill('#F3F4F6');
    roundRect(doc, x, y, cardW, cardH, 10).stroke('#E5E7EB');
    doc.restore();

    doc.fontSize(9).fillColor('#6B7280').text(label, x + 12, y + 10, { width: cardW - 24 });
    doc.fontSize(16).fillColor('#111827').text(value, x + 12, y + 28, { width: cardW - 24 });
  };

  const x1 = margin;
  const x2 = margin + cardW + 12;
  const y1 = doc.y;

  drawCard(x1, y1, kpis[0]);
  drawCard(x2, y1, kpis[1]);
  drawCard(x1, y1 + cardH + 12, kpis[2]);
  drawCard(x2, y1 + cardH + 12, kpis[3]);

  doc.y = y1 + (cardH * 2) + 30;

  // Riesgos / vencimientos (top 8)
  doc.fontSize(12).fillColor('#111827').text('Riesgos y vencimientos', margin);
  doc.moveDown(0.3);

  const list = (summary.alerts || []).slice(0, 8);
  if (!list.length) {
    doc.fontSize(10).fillColor('#6B7280').text('Sin vencimientos críticos.', margin);
  } else {
    list.forEach(a => {
      const due = a.due ? new Date(a.due).toISOString().slice(0,10) : '—';
      doc.fontSize(9).fillColor('#374151')
        .text(`• [${a.type}] ${a.name} — ${due}`, margin, doc.y, { width: contentW });
    });
  }

  doc.moveDown(0.8);

  // Nota confidencial
  doc.fontSize(8).fillColor('#6B7280')
    .text('Documento confidencial para uso interno.', margin, pageH - doc.page.margins.bottom - 28, { width: contentW });
}

function footer(doc, { page, total }) {
  const left   = doc.page.margins.left;
  const right  = doc.page.margins.right;
  const bottom = doc.page.margins.bottom;

  const pageW = doc.page.width;
  const pageH = doc.page.height;

  // ✅ dentro del área imprimible
  const y = pageH - bottom - 12;

  doc.save();
  doc.fontSize(8).fillColor('#6b7280');
  doc.text('Confidencial', left, y, { align: 'left' });
  doc.text(`Página ${page}/${total}`, left, y, { align: 'right', width: pageW - left - right });
  doc.restore();
}


function sectionTitle(doc, title) {
  const margin = doc.page.margins.left;
  doc.moveDown(0.5);
  doc.fontSize(12).fillColor('#111827').text(title, margin);
  doc.moveDown(0.2);
  doc.save();
  doc.lineWidth(0.5).moveTo(margin, doc.y).lineTo(doc.page.width - margin, doc.y).stroke('#e5e7eb');
  doc.restore();
  doc.moveDown(0.6);
}

// Insights (3 bullets máximo)
function buildInsights(title, datasets = {}) {
  const out = [];
  try {
    if (title === 'Ventas mensuales') {
      const sm = datasets.salesMonthly || [];
      const last = sm[sm.length - 1];
      const lastMonth = last?.month || '—';
      const lastUnits = Number(last?.units || 0);
      const last3 = sm.slice(-3).map(x => Number(x.units || 0));
      const avg3 = last3.length ? (last3.reduce((a,b)=>a+b,0)/last3.length) : 0;
      out.push(`Último mes (${lastMonth}): ${lastUnits} unidades.`);
      out.push(`Promedio 3 meses: ${avg3.toFixed(1)} u/mes.`);
    }

    if (title === 'CPP por banco') {
      const list = datasets.cppByBank || [];
      const total = list.reduce((a,x)=>a + Number(x.count||0), 0);
      const top = [...list].sort((a,b)=>Number(b.count||0)-Number(a.count||0))[0];
      out.push(`Total CPP/APROB: ${total}.`);
      if (top) out.push(`Mayor concentración: ${top.bank} (${top.count}).`);
    }

    if (title === 'Permisos por institución') {
      const inst = datasets.permitsByInstitution || [];
      const sum = (k) => inst.reduce((a,x)=>a + Number(x[k]||0), 0);
      out.push(`Aprobados: ${sum('approved')} · Trámite: ${sum('inProcess')} · Pendientes: ${sum('pending')}.`);
      out.push(`Instituciones: ${inst.length}.`);
    }

    if (title === 'Hipotecas por banco') {
      const list = datasets.mortgagesByBank || [];
      const total = list.reduce((a,x)=>a + Number(x.count||0), 0);
      const top = [...list].sort((a,b)=>Number(b.count||0)-Number(a.count||0))[0];
      out.push(`Total hipotecas: ${total}.`);
      if (top) out.push(`Principal banco: ${top.bank} (${top.count}).`);
    }

    if (title === 'Estado de unidades') {
      const list = datasets.unitsByStatus || [];
      const total = list.reduce((a,x)=>a + Number(x.count||0), 0);
      const top = [...list].sort((a,b)=>Number(b.count||0)-Number(a.count||0))[0];
      out.push(`Total unidades (distribución): ${total}.`);
      if (top) out.push(`Estado dominante: ${top.status} (${top.count}).`);
    }

    if (title === 'Progreso por fase') {
      const list = datasets.progressByPhase || [];
      const top = [...list].sort((a,b)=>Number(b.pct||0)-Number(a.pct||0))[0];
      const low = [...list].sort((a,b)=>Number(a.pct||0)-Number(b.pct||0))[0];
      if (top) out.push(`Fase más avanzada: ${top.phase} (${top.pct}%).`);
      if (low) out.push(`Fase menos avanzada: ${low.phase} (${low.pct}%).`);
    }
  } catch (_) {}

  // máximo 3
  return out.slice(0, 3);
}

function drawChart(doc, { title, dataUrl, datasets }) {
  const margin = doc.page.margins.left;

  doc.fontSize(13).fillColor('#111827').text(title, margin);
  doc.moveDown(0.4);

  const buf = dataUrlToBuffer(dataUrl);
  if (buf) {
    // Imagen con fit elegante
    const imgTop = doc.y;
const imgH = 280;

doc.image(buf, margin, imgTop, { fit: [doc.page.width - margin*2, imgH], align: 'center' });

// 👇 PDFKit no baja el cursor con image(), así que lo ponemos nosotros
doc.y = imgTop + imgH + 12;
  } else {
    doc.fontSize(10).fillColor('#6b7280').text('Gráfica no disponible.', margin);
    doc.moveDown(0.6);
  }

  const insights = buildInsights(title, datasets);
  if (insights.length) {
    doc.fontSize(10).fillColor('#374151').text('Notas:', margin);
    doc.moveDown(0.2);
    doc.fontSize(9).fillColor('#4b5563');
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

  const colGap = 12;
  const pageW = doc.page.width - margin*2;
  const colW = (pageW - colGap) / 2;
  const imgH = 160;

  for (let i = 0; i < items.length; i += 2) {
    const left = items[i];
    const right = items[i+1];
    const y0 = doc.y;

    const b1 = await anyImageToBuffer(left);
    if (b1) doc.image(b1, margin, y0, { fit: [colW, imgH] });

    if (right) {
      const b2 = await anyImageToBuffer(right);
      if (b2) doc.image(b2, margin + colW + colGap, y0, { fit: [colW, imgH] });
    }

    doc.y = y0 + imgH + 12;

    if (doc.y > doc.page.height - doc.page.margins.bottom - 80) {
      doc.addPage();
      header(doc, meta);
    }
  }
}


// Orden corporativo (evita Object.keys random)
const CHART_ORDER = [
  { section: 'Operación', items: ['Progreso por fase'] },
  { section: 'Legal', items: ['Permisos por institución', 'CPP por banco'] },
  { section: 'Comercial', items: ['Proformas por banco', 'Estado de unidades', 'Ventas mensuales', 'Hipotecas por banco'] },
  { section: 'Riesgos', items: ['Alertas por severidad', 'Expedientes atrasados por etapa'] },
  { section: 'Finanzas', items: ['Desembolsos plan vs real'] },
];

    // ===== EXPORT =====
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
      ws.addRow(['Vendidas', summary.units.sold]);
      ws.addRow(['Escrituradas', summary.units.escrituradas]);
      ws.addRow(['Canceladas', summary.units.canceladas]);
      ws.addRow([]);
      ws.addRow(['Vencimientos críticos (≤90d)']);
      ws.addRow(['Tipo', 'Nombre', 'Vence']);
      (summary.alerts || []).forEach(a => ws.addRow([a.type, a.name, a.due ? new Date(a.due).toISOString().slice(0,10) : '—']));

      const wsBA = wb.addWorksheet('Antes-Después');
wsBA.getCell('A1').value = 'Evidencia fotográfica — Antes / Después';
wsBA.getRow(1).font = { bold: true, size: 14 };
wsBA.columns = [{ width: 3 }, { width: 50 }, { width: 50 }];

let rBA = 3;
for (let i = 0; i < (beforeAfter || []).length; i += 2) {
  const left = beforeAfter[i]?.src || beforeAfter[i];
  const right = beforeAfter[i+1]?.src || beforeAfter[i+1];

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

      // Insertar charts si vienen
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
  // añade las que existan pero no estén en el orden
  for (const t of keys) if (!orderedTitles.includes(t)) orderedTitles.push(t);

  for (const k of orderedTitles) {
    const dataUrl = charts[k];
    const m = /^data:image\/png;base64,(.+)$/i.exec(String(dataUrl||''));
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
      res.setHeader('Content-Disposition', `attachment; filename="resumen_${id}.xlsx"`);
      await wb.xlsx.write(res);
      return res.end();
    }

    // PDF (corporativo)
const PDFDocument = require('pdfkit');

// IMPORTANT: bufferPages para poder poner footer con total páginas
const doc = new PDFDocument({ margin: 40, bufferPages: true });

res.setHeader('Content-Type', 'application/pdf');
res.setHeader('Content-Disposition', `attachment; filename="resumen_${id}.pdf"`);
doc.pipe(res);

coverPage(doc, { projectName: summary.projectName, updatedAt: summary.updatedAt, summary });

doc.addPage();
header(doc, { projectName: summary.projectName, updatedAt: summary.updatedAt });
sectionTitle(doc, 'Resumen');

// Tabla breve de alertas (top 10)
doc.fontSize(11).fillColor('#111827').text('Vencimientos próximos (top 10):');
doc.moveDown(0.3);
if (!(summary.alerts || []).length) {
  doc.fontSize(10).fillColor('#6b7280').text('Sin vencimientos críticos.');
} else {
  (summary.alerts || []).slice(0, 10).forEach(a => {
    doc.fontSize(9).fillColor('#4b5563')
      .text(`• [${a.type}] ${a.name} — ${a.due ? new Date(a.due).toISOString().slice(0,10) : '—'}`);
  });
}

// ---------- Evidencia Antes/Después ----------
const hasBA = Array.isArray(beforeAfter) && beforeAfter.length > 0;

if (hasBA) {
  sectionTitle(doc, 'Evidencia fotográfica — Antes / Después');
  await drawBeforeAfter(doc, beforeAfter, {
    projectName: summary.projectName,
    updatedAt: summary.updatedAt
  });
}

const normKey = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
  .trim()
  .toLowerCase();

function findChartKey(chartsObj, expectedTitle) {
  const expected = normKey(expectedTitle);
  const keys = Object.keys(chartsObj || {});
  // 1) exacto normalizado
  let k = keys.find(x => normKey(x) === expected);
  if (k) return k;

  // 2) contiene (por si el front añade cosas tipo "(APROB)")
  k = keys.find(x => normKey(x).includes(expected) || expected.includes(normKey(x)));
  return k || null;
}

// ---------- Gráficas por secciones ----------
const chartsSafe = charts || {};
const usedKeys = new Set();

// 1) Primero: el orden corporativo (pero resolviendo keys con match flexible)
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
    // Importante: usa expectedTitle como título bonito, pero la imagen la sacas del realKey
    drawChart(doc, { title: expectedTitle, dataUrl: chartsSafe[realKey], datasets });
  }
}

// 2) Después: cualquier chart que quede fuera del orden (para no perder nada nunca más)
const leftovers = Object.keys(chartsSafe).filter(k => chartsSafe[k] && !usedKeys.has(k));

if (leftovers.length) {
  for (const k of leftovers) {
    doc.addPage();
    header(doc, { projectName: summary.projectName, updatedAt: summary.updatedAt });
    sectionTitle(doc, 'Otras gráficas');
    drawChart(doc, { title: k, dataUrl: chartsSafe[k], datasets });
  }
}


// ---------- Footer con total páginas (2ª pasada) ----------
const range = doc.bufferedPageRange(); // { start: 0, count: N }
for (let i = range.start; i < range.start + range.count; i++) {
  doc.switchToPage(i);
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

const upload = multer({ storage: multer.memoryStorage() });

// POST /api/projects/:id/import-dato-unico
router.post(
  '/:id/import-dato-unico',
  requireRole('admin','bank'),
  requireProjectAccess(),
  upload.single('file'),
  async (req, res) => {
    try {
      const { id } = req.params;
      const tenantKey = req.tenantKey;

      if (!req.file) return res.status(400).json({ error: 'Falta archivo (file)' });

      const wb = XLSX.read(req.file.buffer, { type: 'buffer' });

      // Hoja del excel
      const sheetName =
        wb.SheetNames.find(s => String(s).trim().toUpperCase() === 'EXPEDIENTES-BANCO') ||
        wb.SheetNames[0];

      const ws = wb.Sheets[sheetName];

      // Leemos como matriz (header=1) porque tu excel tiene fila 1 "ETAPA I" y la 2 es header real
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      if (rows.length < 3) return res.status(400).json({ error: 'Excel vacío o formato inesperado' });

      const header = rows[1].map(h => String(h || '').trim());

      // ✅ filas de datos (a partir de la fila 3). Quitamos filas vacías
const dataRows = rows
  .slice(2)
  .filter(r => Array.isArray(r) && r.some(v => String(v ?? '').trim() !== ''));

// Normalizador fuerte de headers
const normHeader = (s) => String(s || '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // quita acentos
  .replace(/\s+/g, ' ')                             // colapsa espacios
  .trim()
  .toUpperCase();

// Mapa: headerNormalizado -> headerOriginal
const headerMap = new Map();
for (const h of header) headerMap.set(normHeader(h), h);

// Getter robusto por lista de nombres "posibles"
const get = (rowObj, names) => {
  for (const n of names) {
    const key = headerMap.get(normHeader(n));
    if (key && rowObj[key] !== undefined) return rowObj[key];
  }
  return '';
};

      const asDate = (v) => {
        if (!v) return undefined;
        if (v instanceof Date && !isNaN(v)) return v;
        // XLSX a veces trae número excel-date
        if (typeof v === 'number') {
          const d = XLSX.SSF.parse_date_code(v);
          if (d) return new Date(Date.UTC(d.y, d.m - 1, d.d));
        }
        const d = new Date(v);
        return isNaN(d) ? undefined : d;
      };

      const asNum = (v) => {
        if (v === '' || v === null || v === undefined) return undefined;
        const n = Number(String(v).replace(/\./g,'').replace(',','.'));
        return Number.isFinite(n) ? n : undefined;
      };

      const norm = s => String(s||'').trim().toLowerCase();

      // 1) precarga unidades existentes para mapear unitId por (manzana|lote)
      const existingUnits = await Unit.find({ tenantKey, projectId: id, deletedAt: null }).lean();
      const unitKey = (mz, lt) => `${String(mz||'').trim().toUpperCase()}|${String(lt||'').trim().toUpperCase()}`;
      const unitMap = new Map(existingUnits.map(u => [unitKey(u.manzana, u.lote), u]));

      let unitsUpserted = 0;
      let ventasUpserted = 0;

      const setUnitEstado = async (unitId, estadoValue) => {
  await Unit.updateOne(
    { _id: unitId },
    { $set: { estado: estadoValue, status: estadoValue } }
  );
};

      for (const r of dataRows) {
        // rowObj con claves = header real
        const rowObj = {};
        header.forEach((h, i) => rowObj[h] = r[i] ?? '');

        // Claves mínimas
        const manzana = get(rowObj, ['MANZANA']);
        const lote    = get(rowObj, ['LOTE']);
        if (!manzana && !lote) continue;

        // 2) Unit: crear si no existe
        const uKey = unitKey(manzana, lote);
        let unit = unitMap.get(uKey);

        // helper normalize
const normTxt = (v) => String(v ?? '')
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .trim()
  .toUpperCase();

const parseEstado = (raw) => {
  const t = normTxt(raw);
  if (!t) return null;

  // más “final” gana
  if (t.includes('CANCEL') || t.includes('ANUL')) return 'cancelado';
  if (t.includes('ENTREG')) return 'entregado';
  if (t.includes('ESCRITURAD')) return 'escriturado';
  if ((t.includes('EN') && t.includes('ESCRIT')) || t.includes('ESCRITURACION')) return 'en_escrituracion';
  if (t.includes('RESERV')) return 'reservado';
  if (t.includes('DISPON')) return 'disponible';

  return null;
};

// 1) intenta leer de "ESTATUS CTTO"
const idxEstatus = header.findIndex(h => {
  const hh = normHeader(h);
  return hh === 'ESTATUS CTTO' || hh.startsWith('ESTATUS CTTO');
});

let estado =
  parseEstado(get(rowObj, ['ESTATUS CTTO', 'ESTATUS CTTO ', 'ESTATUS CTTO.'])) ||
  null;

// 2) si ahí no era (en tu Excel sale "CPP/CLIENTE"), prueba la celda de al lado
if (!estado && idxEstatus >= 0) {
  estado = parseEstado(r[idxEstatus + 1]); // <-- la columna siguiente
}

// 3) fallback extra por si el Excel viene raro
if (!estado) {
  estado = parseEstado(get(rowObj, ['ESTADO', 'ESTATUS', 'STATUS', 'ESTADO UNIDAD', 'ESTATUS UNIDAD']));
}

if (!estado) estado = 'disponible';


        const precioLista = asNum(get(rowObj, ['VALOR','VALOR '])) || 0;

        if (!unit) {
          unit = await Unit.create({
  tenantKey,
  projectId: id,
  manzana: String(manzana).trim(),
  lote: String(lote).trim(),
  modelo: String(get(rowObj, ['MODELO','MODELO ']) || '').trim(),
  precioLista
});

// ✅ asegurar estado en el campo correcto
await setUnitEstado(unit._id, estado);

          unitMap.set(uKey, unit.toObject ? unit.toObject() : unit);
          unitsUpserted++;
        } else {
          // si quieres, actualiza estado/precio
          await Unit.updateOne(
  { _id: unit._id },
  { $set: { precioLista } }
);

// ✅ asegurar estado en el campo correcto
await setUnitEstado(unit._id, estado);

        }

        // 3) Venta: mapeo Excel -> schema Venta
        const payload = {
          tenantKey,
          projectId: id,
          unitId: unit._id,

          manzana: String(manzana || '').trim(),
          lote: String(lote || '').trim(),

          clienteNombre: String(get(rowObj, ['CLIENTE','CLIENTE ']) || '').trim(),
          cedula:        String(get(rowObj, ['CEDULA','CÉDULA']) || '').trim(),
          empresa:       String(get(rowObj, ['EMPRESA']) || '').trim(),

          banco:        String(get(rowObj, ['BANCO']) || '').trim(),
          oficialBanco: String(get(rowObj, ['OFICIAL DE BANCO','OFICIAL BANCO']) || '').trim(),
          statusBanco:  String(get(rowObj, ['STATUS EN BANCO','STATUS  EN BANCO']) || '').trim(),
          numCPP:       String(get(rowObj, ['N° CPP','Nº CPP','NUM CPP']) || '').trim(),
          valor:        asNum(get(rowObj, ['VALOR'])) || 0,

          entregaExpedienteBanco: asDate(get(rowObj, ['ENTREGA DE EXPEDIENTE A BANCO'])),
          recibidoCPP:            asDate(get(rowObj, ['RECIBIDO DE CPP'])),
          plazoAprobacionDias:    asNum(get(rowObj, ['PLAZO APROBACION'])),

          fechaValorCPP:       asDate(get(rowObj, ['FECHA VALOR DE CPP'])),
          fechaVencimientoCPP: asDate(get(rowObj, ['FECHA DE VENCIMIENTO CCP'])),
          vencimientoCPPBnMivi:asDate(get(rowObj, ['VENCIMIENTO CPP BN-MIVI'])),

          fechaContratoCliente: asDate(get(rowObj, ['FECHA CONTRATO FIRMADO POR CLIENTE'])),

          estatusContrato: String(get(rowObj, ['ESTATUS CTTO']) || '').trim(),
          pagare:          String(get(rowObj, ['PAGARE']) || '').trim(),
          fechaFirma:      asDate(get(rowObj, ['FECHA FIRMA'])),

          protocoloFirmaCliente:      !!get(rowObj, ['PROTOCOLO FIRMA CLIENTE']),
          fechaEntregaBanco:          asDate(get(rowObj, ['FECHA ENTREGA BANCO'])),
          protocoloFirmaRLBancoInter: !!get(rowObj, ['PROTOCOLO FIRMA RL BANCO INTER']),
          fechaRegresoBanco:          asDate(get(rowObj, ['FECHA REGRESO BANCO'])),
          diasTranscurridosBanco:     asNum(get(rowObj, ['DIAS TRANSCURRIDOS BANCO'])),

          fechaEntregaProtocoloBancoCli: asDate(get(rowObj, ['FECHA ENTREGA PROTOCOLO BANCO CLI'])),
          firmaProtocoloBancoCliente:    !!get(rowObj, ['FIRMA PROTOCOLO BANCO CLIENTE']),
          fechaRegresoProtocoloBancoCli: asDate(get(rowObj, ['FECHA REGRESO PROTOCOLO BANCO CLI'])),
          diasTranscurridosProtocolo:    asNum(get(rowObj, ['DIAS TRANSCURRIDOS PROTOCOLO'])),

          cierreNotaria:     asDate(get(rowObj, ['CIERRE DE NOTARIA'])),
          fechaPagoImpuesto: asDate(get(rowObj, ['FECHA DE PAGO DE IMPUESTO'])),
          ingresoRP:         asDate(get(rowObj, ['INGRESO AL RP'])),
          fechaInscripcion:  asDate(get(rowObj, ['FECHA DE INSCRIPCION'])),

          solicitudDesembolso: asDate(get(rowObj, ['SOLICITUD DE DESEMBOLSO'])),
          fechaRecibidoCheque: asDate(get(rowObj, ['FECHA DE RECIBIDO DE CK'])),

          expedienteMIVI:      String(get(rowObj, ['EXPEDIENTE MIVI']) || '').trim(),
          entregaExpMIVI:      asDate(get(rowObj, ['ENTREGA EXP MIVI'])),
          resolucionMIVI:      String(get(rowObj, ['N° DE RESOLUCION MIVI','RESOLUCION MIVI']) || '').trim(),
          fechaResolucionMIVI: asDate(get(rowObj, ['FECHA RESOLUCION MIVI'])),
          solicitudMiviDesembolso: asDate(get(rowObj, ['SOLICITUD MIVI DESEMBOLSO'])),
          desembolsoMivi:      asNum(get(rowObj, ['DESEMBOLSO MIVI'])),
          fechaPagoMivi:       asDate(get(rowObj, ['FECHA PAGO MIVI'])),

          enConstruccion:       !!get(rowObj, ['EN CONSTRUCCION']),
          faseConstruccion:     String(get(rowObj, ['FASE CONSTRUCCION']) || '').trim(),
          permisoConstruccionNum:String(get(rowObj, ['N° RESOLUCION']) || '').trim(),
          permisoOcupacion:     !!get(rowObj, ['PERMISO OCUPACION']),
          permisoOcupacionNum:  String(get(rowObj, ['PERMISO OCUPACION NUM']) || '').trim(),
          constructora:         String(get(rowObj, ['CONSTRUCTORA']) || '').trim(),

          pazSalvoGesproban: !!get(rowObj, ['PAZ Y SALVO GESPROBAN']),
          pazSalvoPromotora: !!get(rowObj, ['PAZ Y SALVO PROMOTORA']),

          mLiberacion:  String(get(rowObj, ['M. DE LIBERACION']) || '').trim(),
          mSegregacion: String(get(rowObj, ['M. SEGREGACION']) || '').trim(),
          mPrestamo:    String(get(rowObj, ['M. PRESTAMO']) || '').trim(),
          solicitudAvaluo: asDate(get(rowObj, ['SOLICITUD AVALUO'])),
          avaluoRealizado: asDate(get(rowObj, ['AVALUO REALIZADO'])),
          entregaCasa:     asDate(get(rowObj, ['ENTREGA DE CASA'])),
          entregaANATI:    asDate(get(rowObj, ['ENTREGA ANATI'])),

          comentario: String(get(rowObj, ['COMENTARIO']) || '').trim(),
        };

        await Venta.findOneAndUpdate(
  { tenantKey, projectId: id, unitId: unit._id },
  { $set: payload },
  { upsert: true, new: true, runValidators: true }
);
        ventasUpserted++;
      }

      // ✅ NUEVO: recalcular KPIs de cabecera del proyecto (los “cards de arriba”)
      // - unitsTotal: unidades en Unit (no borradas)
      // - unitsSold: ventas existentes (o si prefieres: unidades con estado != disponible)
      // - ticketPromedio: promedio de valor de ventas (para tu Summary)
      const [unitsTotal, unitsSold, agg] = await Promise.all([
        Unit.countDocuments({ tenantKey, projectId: id, deletedAt: null }),
        Unit.countDocuments({
  tenantKey,
  projectId: id,
  deletedAt: null,
  $or: [
    { estado: { $in: ['reservado','en_escrituracion','escriturado','entregado'] } },
    { status: { $in: ['reservado','en_escrituracion','escriturado','entregado'] } },
  ]
}),
        Venta.aggregate([
          { $match: { tenantKey, projectId: new mongoose.Types.ObjectId(id) } },
          { $group: { _id: null, avgValor: { $avg: '$valor' }, sumValor: { $sum: '$valor' } } }
        ])
      ]);

      const ticketPromedio = Number(agg?.[0]?.avgValor || 0);
      const valorTotalVentas = Number(agg?.[0]?.sumValor || 0);

      // Guardar en Project con nombres flexibles (para no romper tu schema)
      const p = await Project.findOne({ _id: id, tenantKey });
      if (p) {
        const FIELD_CANDIDATES = {
          unitsTotal:     ['unitsTotal','unidadesTotales','unidades_totales'],
          unitsSold:      ['unitsSold','unidadesVendidas','unidades_vendidas'],
          ticketPromedio: ['ticketPromedio','ticket_promedio','avgTicket','averageTicket'],
          valorVentas:    ['valorVentas','ventasTotal','totalVentas','ventas_total'],
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
        // 👇 para que lo veas en consola/Network y confirmes que se actualiza
        kpisProyecto: { unitsTotal, unitsSold, ticketPromedio, valorTotalVentas }
      });
    } catch (e) {
      console.error('[IMPORT DATO UNICO]', e);
      res.status(500).json({ error: e.message });
    }
  }
);

module.exports = router;
