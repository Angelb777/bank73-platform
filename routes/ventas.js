'use strict';
const express = require('express');
const router = express.Router();

const Venta = require('../models/Venta');
const Project = require('../models/Project'); // ROLE-SEP
const Unit = require('../models/Unit'); // ROLE-SEP
const { requireProjectAccess } = require('../middleware/rbac'); // ROLE-SEP
const { recomputeCommercialKpis } = require('../services/comercial_kpis');

// --- Whitelist de campos permitidos (coincide con tu schema Venta) ---
const ALLOWED_FIELDS = new Set([
  // básicos
  'clienteNombre', 'cedula', 'empresa', 'banco', 'oficialBanco', 'statusBanco', 'numCPP',
  'montoFinanciamientoCPP', 'precioVenta', 'valor',
  'fechaContratoCliente',

  // espejo unidad (opcional para reportes)
  'manzana', 'lote',

  // banco / cpp
  'entregaExpedienteBanco', 'recibidoCPP', 'plazoAprobacionDias', 'fechaValorCPP',
  'fechaVencimientoCPP', 'vencimientoCPPBnMivi',

  // contrato / protocolo / notaría / RP / desembolso
  'estatusContrato', 'pagare', 'fechaFirma', 'protocoloFirmaCliente', 'fechaEntregaBanco',
  'protocoloFirmaRLBancoInter', 'fechaRegresoBanco', 'diasTranscurridosBanco',
  'fechaEntregaProtocoloBancoCli', 'firmaProtocoloBancoCliente',
  'fechaRegresoProtocoloBancoCli', 'diasTranscurridosProtocolo',
  'cierreNotaria', 'fechaPagoImpuesto', 'ingresoRP', 'fechaInscripcion',
  'solicitudDesembolso', 'fechaRecibidoCheque',

  // MIVI
  'expedienteMIVI', 'entregaExpMIVI', 'resolucionMIVI', 'fechaResolucionMIVI',
  'solicitudMiviDesembolso', 'desembolsoMivi', 'fechaPagoMivi',

  // Obra / permisos / paz y salvo / otros
  'enConstruccion', 'faseConstruccion', 'permisoConstruccionNum', 'permisoOcupacion',
  'permisoOcupacionNum', 'constructora', 'pazSalvoGesproban', 'pazSalvoPromotora',
  'mLiberacion', 'mSegregacion', 'mPrestamo', 'solicitudAvaluo', 'avaluoRealizado',
  'entregaCasa', 'entregaANATI', 'comentario',

  // importante
  'checklist'
]);

const STEP_STATES = ['pendiente', 'en_proceso', 'completado', 'bloqueado'];

function sanitizeChecklist(input) {
  if (!Array.isArray(input)) return [];
  return input.map(s => ({
    code: String(s.code || '').trim(),
    state: STEP_STATES.includes(s.state) ? s.state : 'pendiente',
    note: String(s.note || ''),
    dueAt: s.dueAt ? new Date(s.dueAt) : undefined,
    doneAt: s.doneAt ? new Date(s.doneAt) : undefined,
  })).filter(x => x.code);
}

function pickAllowed(obj = {}) {
  const out = {};
  for (const k in obj) {
    if (ALLOWED_FIELDS.has(k)) out[k] = obj[k];
  }
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
    const v = await Venta.findOne({
      _id: req.params.id,
      tenantKey: req.tenantKey,
      deletedAt: null
    }).lean();

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
    req._venta = await Venta.findOne({
      tenantKey: req.tenantKey,
      unitId: unit._id,
      projectId: proj._id,
      deletedAt: null
    }).lean();

    next();
  } catch (e) {
    return res.status(400).json({ error: 'ID inválido' });
  }
}

async function syncProjectKpisSafe(req, projectId) {
  try {
    await recomputeCommercialKpis({ tenantKey: req.tenantKey, projectId });
  } catch (e) {
    console.warn('[ventas] recomputeCommercialKpis failed:', e?.message || e);
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

      const list = await Venta.find({
        tenantKey: req.tenantKey,
        projectId,
        deletedAt: null
      }).sort({ createdAt: -1 }).lean();

      res.json(list);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
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
      const v = req._venta || await Venta.findOne({
        tenantKey: req.tenantKey,
        unitId: req.params.unitId,
        deletedAt: null
      }).lean();

      if (!v) return res.status(404).json({ error: 'No existe' });
      res.json(v);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

/* =========================================================================
   POST /ventas (crear o reactivar si ya existe por unitId)
   ========================================================================= */
router.post(
  '/',
  attachProjectByProjectId,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req, res) => {
    try {
      const { projectId, unitId } = req.body || {};
      if (!projectId || !unitId) {
        return res.status(400).json({ error: 'projectId y unitId requeridos' });
      }

      const base = pickAllowed(req.body);
      base.projectId = projectId;
      base.unitId = unitId;
      base.tenantKey = req.tenantKey;
      base.deletedAt = null;

      if ('checklist' in req.body) {
        base.checklist = sanitizeChecklist(req.body.checklist);
      }

      const u = await Unit.findById(unitId).select('manzana lote').lean();
      if (u) {
        base.manzana = base.manzana || u.manzana;
        base.lote = base.lote || u.lote;
      }

      const saved = await Venta.findOneAndUpdate(
        {
          tenantKey: req.tenantKey,
          projectId,
          unitId
        },
        {
          $set: {
            ...base,
            deletedAt: null
          }
        },
        { new: true, upsert: true, runValidators: true }
      );

      await syncProjectKpisSafe(req, projectId);

      const dto = await Venta.findById(saved._id).lean();
      res.json(dto);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
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
      if (!projectId || !unitId) {
        return res.status(400).json({ error: 'projectId y unitId requeridos' });
      }

      const set = pickAllowed(data);
      set.tenantKey = req.tenantKey;

      if ('checklist' in data) {
        set.checklist = sanitizeChecklist(data.checklist);
      }

      if (!set.manzana || !set.lote) {
        const u = await Unit.findById(unitId).select('manzana lote').lean();
        if (u) {
          if (!set.manzana) set.manzana = u.manzana;
          if (!set.lote) set.lote = u.lote;
        }
      }

      const updated = await Venta.findOneAndUpdate(
        {
          tenantKey: req.tenantKey,
          projectId,
          unitId
        },
        {
          $set: {
            ...set,
            deletedAt: null
          }
        },
        { new: true, upsert: true, runValidators: true }
      );

      await syncProjectKpisSafe(req, projectId);

      const dto = await Venta.findById(updated._id).lean();
      res.json(dto);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
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

      let modified = 0;
      let created = 0;

      if (upsert) {
        for (const unitId of unitIds) {
          const existed = await Venta.findOne({
            tenantKey: req.tenantKey,
            projectId,
            unitId,
            deletedAt: null
          }).select('_id').lean();

          const r = await Venta.findOneAndUpdate(
            {
              tenantKey: req.tenantKey,
              projectId,
              unitId
            },
            {
              $set: {
                ...set,
                deletedAt: null
              }
            },
            { upsert: true, new: true, runValidators: true }
          );

          if (!existed && r?._id) created++;
          else if (r?._id) modified++;
        }
      } else {
        const r = await Venta.updateMany(
          {
            tenantKey: req.tenantKey,
            projectId,
            unitId: { $in: unitIds },
            deletedAt: null
          },
          {
            $set: set
          },
          { runValidators: true }
        );
        modified = r.modifiedCount || 0;
      }

      await syncProjectKpisSafe(req, projectId);

      res.json({ modified, created });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

/* =========================================================================
   PATCH /ventas/:id
   ========================================================================= */
router.patch(
  '/:id',
  attachProjectByVenta,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req, res) => {
    try {
      const set = pickAllowed(req.body);

      if ('checklist' in req.body) {
        set.checklist = sanitizeChecklist(req.body.checklist);
      }

      const updated = await Venta.findOneAndUpdate(
        {
          _id: req.params.id,
          tenantKey: req.tenantKey,
          deletedAt: null
        },
        { $set: set },
        { new: true, runValidators: true }
      );

      if (!updated) return res.status(404).json({ error: 'No existe' });

      await syncProjectKpisSafe(req, updated.projectId);

      const dto = await Venta.findById(updated._id).lean();
      res.json(dto);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

module.exports = router;