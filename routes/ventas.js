'use strict';
const express = require('express');
const router = express.Router();

const Venta   = require('../models/Venta');
const Project = require('../models/Project'); // ROLE-SEP
const Unit    = require('../models/Unit');    // ROLE-SEP
const { requireProjectAccess } = require('../middleware/rbac'); // ROLE-SEP

// --- Whitelist de campos permitidos (coincide con tu schema Venta) ---
const ALLOWED_FIELDS = new Set([
  // básicos
  'clienteNombre','cedula','empresa','banco','oficialBanco','statusBanco','numCPP','valor',
  'fechaContratoCliente',

  // espejo unidad (opcional para reportes)
  'manzana','lote',

  // banco / cpp
  'entregaExpedienteBanco','recibidoCPP','plazoAprobacionDias','fechaValorCPP',
  'fechaVencimientoCPP','vencimientoCPPBnMivi',

  // contrato / protocolo / notaría / RP / desembolso
  'estatusContrato','pagare','fechaFirma','protocoloFirmaCliente','fechaEntregaBanco',
  'protocoloFirmaRLBancoInter','fechaRegresoBanco','diasTranscurridosBanco',
  'fechaEntregaProtocoloBancoCli','firmaProtocoloBancoCliente',
  'fechaRegresoProtocoloBancoCli','diasTranscurridosProtocolo',
  'cierreNotaria','fechaPagoImpuesto','ingresoRP','fechaInscripcion',
  'solicitudDesembolso','fechaRecibidoCheque',

  // MIVI
  'expedienteMIVI','entregaExpMIVI','resolucionMIVI','fechaResolucionMIVI',
  'solicitudMiviDesembolso','desembolsoMivi','fechaPagoMivi',

  // Obra / permisos / paz y salvo / otros
  'enConstruccion','faseConstruccion','permisoConstruccionNum','permisoOcupacion',
  'permisoOcupacionNum','constructora','pazSalvoGesproban','pazSalvoPromotora',
  'mLiberacion','mSegregacion','mPrestamo','solicitudAvaluo','avaluoRealizado',
  'entregaCasa','entregaANATI','comentario',

  // ✅ importante
  'checklist'
]);

// Sanitizador simple para el checklist que llega del front
const STEP_STATES = ['pendiente','en_proceso','completado','bloqueado'];
function sanitizeChecklist(input) {
  if (!Array.isArray(input)) return [];
  return input.map(s => ({
    code:  String(s.code || '').trim(),
    state: STEP_STATES.includes(s.state) ? s.state : 'pendiente',
    note:  String(s.note || ''),
    dueAt: s.dueAt ? new Date(s.dueAt) : undefined,
    doneAt:s.doneAt? new Date(s.doneAt): undefined,
  })).filter(x => x.code); // descarta vacíos
}

function pickAllowed(obj = {}) {
  const out = {};
  for (const k in obj) if (ALLOWED_FIELDS.has(k)) out[k] = obj[k];
  return out;
}

// ROLE-SEP: marcar este router como "ventas" para el guard de comerciales
router.use((req, _res, next) => { req.isSalesRoute = true; next(); }); // ROLE-SEP

// ROLE-SEP: helpers para cargar proyecto en req.project
async function attachProjectByProjectId(req, res, next) {
  try {
    const projectId = req.body?.projectId || req.query?.projectId;
    if (!projectId) return res.status(400).json({ error: 'projectId requerido' });

    const proj = await Project.findOne({ _id: projectId, tenantKey: req.tenantKey }).lean();
    if (!proj) return res.status(404).json({ error: 'Proyecto no encontrado' });

    req.project = proj;
    next();
  } catch (e) {
    return res.status(400).json({ error: 'projectId inválido' });
  }
}

async function attachProjectByVenta(req, res, next) {
  try {
    const v = await Venta.findById(req.params.id).lean();
    if (!v) return res.status(404).json({ error: 'No existe' });

    const proj = await Project.findOne({ _id: v.projectId, tenantKey: req.tenantKey }).lean();
    if (!proj) return res.status(404).json({ error: 'Proyecto no encontrado' });

    req.project = proj;
    req._venta = v;
    next();
  } catch (e) {
    return res.status(400).json({ error: 'ID inválido' });
  }
}

async function attachProjectByUnitIdFromVenta(req, res, next) {
  try {
    const { unitId } = req.params;
    const unit = await Unit.findById(unitId).lean();
    if (!unit) return res.status(404).json({ error: 'Unidad no existe' });

    const proj = await Project.findOne({ _id: unit.projectId, tenantKey: req.tenantKey }).lean();
    if (!proj) return res.status(404).json({ error: 'Proyecto no encontrado' });

    req.project = proj;
    // venta puede no existir aún; no bloqueamos
    req._venta = await Venta.findOne({ unitId: unit._id, projectId: proj._id }).lean();
    next();
  } catch (e) {
    return res.status(400).json({ error: 'ID inválido' });
  }
}

/* =========================================================================
   GET /ventas?projectId=...
   ========================================================================= */
router.get(
  '/',
  attachProjectByProjectId,
  requireProjectAccess(),
  async (req, res) => {
    try {
      const { projectId } = req.query;
      const list = await Venta.find({ projectId }).sort({ createdAt: -1 }).lean();
      res.json(list);
    } catch (e) { res.status(500).json({ error: e.message }); }
  }
);

/* =========================================================================
   GET /ventas/by-unit/:unitId
   ========================================================================= */
router.get(
  '/by-unit/:unitId',
  attachProjectByUnitIdFromVenta,
  requireProjectAccess(),
  async (req, res) => {
    try {
      const v = req._venta || await Venta.findOne({ unitId: req.params.unitId }).lean();
      if (!v) return res.status(404).json({ error: 'No existe' });
      res.json(v);
    } catch (e) { res.status(400).json({ error: e.message }); }
  }
);

/* =========================================================================
   POST /ventas (crear)
   ========================================================================= */
router.post(
  '/',
  attachProjectByProjectId,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req, res) => {
    try {
      const { projectId, unitId } = req.body || {};
      if (!projectId || !unitId) return res.status(400).json({ error: 'projectId y unitId requeridos' });

      const base = pickAllowed(req.body);
      base.projectId = projectId;
      base.unitId    = unitId;
      base.tenantKey = req.tenantKey;

      // ✅ saneo opcional si te llega checklist ya en el create
      if ('checklist' in base) {
        base.checklist = sanitizeChecklist(base.checklist);
      }

      // espejo manzana/lote (opcional)
      const u = await Unit.findById(unitId).select('manzana lote').lean();
      if (u) { base.manzana = base.manzana || u.manzana; base.lote = base.lote || u.lote; }

      const created = await Venta.create(base);
      // devolver siempre lean
      const dto = await Venta.findById(created._id).lean();
      res.json(dto);
    } catch (e) { res.status(400).json({ error: e.message }); }
  }
);

/* =========================================================================
   POST /ventas/upsert-by-unit (crear/actualizar por unitId)
   ========================================================================= */
router.post(
  '/upsert-by-unit',
  attachProjectByProjectId,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req, res) => {
    try {
      const { projectId, unitId, ...data } = req.body || {};
      if (!projectId || !unitId) return res.status(400).json({ error: 'projectId y unitId requeridos' });

      const set = pickAllowed(data);
      set.tenantKey = req.tenantKey;

      // ✅ saneo del checklist si viene
      if ('checklist' in data) {
        set.checklist = sanitizeChecklist(data.checklist);
      }

      // espejo manzana/lote
      if (!set.manzana || !set.lote) {
        const u = await Unit.findById(unitId).select('manzana lote').lean();
        if (u) { if (!set.manzana) set.manzana = u.manzana; if (!set.lote) set.lote = u.lote; }
      }

      const updated = await Venta.findOneAndUpdate(
        { projectId, unitId },
        { $set: set },
        { new: true, upsert: true, runValidators: true } // ✅ valida enum/fechas
      );

      // devolver siempre lean
      const dto = await Venta.findById(updated._id).lean();
      res.json(dto);
    } catch (e) { res.status(400).json({ error: e.message }); }
  }
);

/* =========================================================================
   PATCH /ventas/batch (editar por lote)
   ========================================================================= */
router.patch(
  '/batch',
  attachProjectByProjectId,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req, res) => {
    try {
      const { unitIds = [], update = {}, upsert = false, projectId } = req.body || {};
      if (!unitIds.length) return res.status(400).json({ error: 'unitIds requerido' });

      const set = pickAllowed(update);
      set.tenantKey = req.tenantKey;

      // ⚠️ No solemos permitir checklist en batch; si lo necesitas, también podrías sanear aquí.

      let modified = 0, created = 0;

      if (upsert) {
        for (const unitId of unitIds) {
          const r = await Venta.findOneAndUpdate(
            { projectId, unitId },
            { $set: set },
            { upsert: true, new: true, runValidators: true }
          );
          if (r && r._id) modified++;
        }
      } else {
        const r = await Venta.updateMany(
          { projectId, unitId: { $in: unitIds } },
          { $set: set },
          { runValidators: true }
        );
        modified = r.modifiedCount || 0;
      }
      res.json({ modified, created });
    } catch (e) { res.status(400).json({ error: e.message }); }
  }
);

/* =========================================================================
   PATCH /ventas/:id (actualizar)  ✅ ÚNICO
   ========================================================================= */
router.patch(
  '/:id',
  attachProjectByVenta,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req, res) => {
    try {
      const set = pickAllowed(req.body);

      // ✅ Checklist (si viene) con saneo
      if ('checklist' in req.body) {
        set.checklist = sanitizeChecklist(req.body.checklist);
      }

      const updated = await Venta.findByIdAndUpdate(
        req.params.id,
        { $set: set },
        { new: true, runValidators: true }
      );

      if (!updated) return res.status(404).json({ error: 'No existe' });

      // devolver siempre lean
      const dto = await Venta.findById(updated._id).lean();
      res.json(dto);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

module.exports = router;
