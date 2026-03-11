const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Unit = require('../models/Unit');
const Venta = require('../models/Venta');
const Project = require('../models/Project'); // ROLE-SEP
const requirePin = require('../utils/requirePin');

const { requireProjectAccess } = require('../middleware/rbac'); // ROLE-SEP

// ✅ recalcular KPIs comerciales y persistir en Project
const { recomputeCommercialKpis } = require('../services/comercial_kpis');

// ROLE-SEP: marcar este router como "units" para el guard de comerciales
router.use((req, _res, next) => { req.isUnitsRoute = true; next(); }); // ROLE-SEP

function rx(q) {
  return new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

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

async function attachProjectByUnitId(req, res, next) {
  try {
    const { id } = req.params;

    const unit = await Unit.findById(id).lean();
    if (!unit) return res.status(404).json({ error: 'Unidad no encontrada' });

    const proj = await Project.findOne({ _id: unit.projectId, tenantKey: req.tenantKey }).lean();
    if (!proj) return res.status(404).json({ error: 'Proyecto no encontrado' });

    req.project = proj;
    req._unit = unit;
    next();
  } catch (e) {
    return res.status(400).json({ error: 'ID inválido' });
  }
}

// ✅ helper “no rompas la operación si falla el recálculo”
async function syncProjectKpisSafe(req, projectId) {
  try {
    await recomputeCommercialKpis({ tenantKey: req.tenantKey, projectId });
  } catch (e) {
    console.warn('[units] recomputeCommercialKpis failed:', e?.message || e);
  }
}

/* =========================================================================
   POST /units/batch  (modo A: cantidad)
   ========================================================================= */
router.post(
  '/batch',
  attachProjectByProjectId,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req, res) => {
    try {
      const { projectId, manzana, cantidad, modelo, m2, precioLista, estado } = req.body;
      if (!projectId || !manzana || !cantidad) {
        return res.status(400).json({ error: 'projectId, manzana y cantidad son requeridos' });
      }

      const lotes = Array.from({ length: parseInt(cantidad, 10) }, (_, i) => String(i + 1));

      const docs = lotes.map(lote => ({
        tenantKey: req.tenantKey,
        projectId,
        manzana,
        lote,
        modelo: modelo || '',
        m2: m2 || 0,
        precioLista: precioLista || 0,
        estado: estado || 'disponible',
        deletedAt: null,

        // legacy
        code: `${manzana}-${lote}`,
        status: (estado || 'disponible').toUpperCase(),
        price: precioLista || 0
      }));

      const created = await Unit.insertMany(docs, { ordered: false });

      await syncProjectKpisSafe(req, projectId);

      res.json(created);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

/* =========================================================================
   GET /units  (filtros: projectId, estado, manzana, q)
   ========================================================================= */
router.get(
  '/',
  attachProjectByProjectId,
  requireProjectAccess(),
  async (req, res) => {
    try {
      const { projectId, estado, manzana, q } = req.query;
      if (!projectId) return res.status(400).json({ error: 'projectId requerido' });

      const filter = { tenantKey: req.tenantKey, projectId, deletedAt: null };
      if (estado) filter.estado = estado;
      if (manzana) filter.manzana = manzana;

      const text = q
        ? { $or: [{ code: rx(q) }, { modelo: rx(q) }, { manzana: rx(q) }, { lote: rx(q) }] }
        : {};

      const list = await Unit.find({ ...filter, ...text })
        .populate('clienteId')
        .sort({ manzana: 1, lote: 1 });

      res.json(list);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

/* =========================================================================
   PATCH /api/units/batch
   ========================================================================= */
router.patch(
  '/batch',
  attachProjectByProjectId,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req, res) => {
    try {
      const { ids = [], update = {} } = req.body || {};
      if (!ids.length) return res.status(400).json({ error: 'ids requerido' });

      const set = { ...update };
      if (set.precioLista != null) set.price = set.precioLista;
      if (set.estado) set.status = String(set.estado).toUpperCase();

      const ops = ids.map(_id => ({
        updateOne: {
          filter: { _id },
          update: { $set: set }
        }
      }));

      const r = await Unit.bulkWrite(ops, { ordered: false });

      // ✅ si cambia el precio de la unidad, sincronizamos también Venta.valor
      if (set.precioLista != null) {
        await Venta.updateMany(
          {
            tenantKey: req.tenantKey,
            projectId: req.project._id,
            unitId: { $in: ids }
          },
          {
            $set: { valor: Number(set.precioLista || 0) }
          }
        );
      }

      await syncProjectKpisSafe(req, req.project._id);

      res.json({ matched: r.matchedCount, modified: r.modifiedCount });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

/* =========================================================================
   DELETE /api/units/batch
   ========================================================================= */
router.delete(
  '/batch',
  attachProjectByProjectId,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req, res) => {
    const bad = requirePin(req, res);
    if (bad) return;

    try {
      const { ids = [] } = req.body || {};
      if (!ids.length) return res.status(400).json({ error: 'ids requerido' });

      const now = new Date();

      // 1) soft delete unidades
      const r = await Unit.updateMany(
        {
          tenantKey: req.tenantKey,
          projectId: req.project._id,
          _id: { $in: ids }
        },
        { $set: { deletedAt: now } }
      );

      // 2) soft delete ventas asociadas a esas unidades
      await Venta.updateMany(
        {
          tenantKey: req.tenantKey,
          projectId: req.project._id,
          unitId: { $in: ids },
          deletedAt: null
        },
        { $set: { deletedAt: now } }
      );

      await syncProjectKpisSafe(req, req.project._id);

      res.json({ modified: r.modifiedCount });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

/* =========================================================================
   GET /units/:id  (detalle)
   ========================================================================= */
router.get(
  '/:id',
  attachProjectByUnitId,
  requireProjectAccess(),
  async (req, res) => {
    try {
      const u = await Unit.findById(req.params.id).populate('clienteId');
      if (!u || u.deletedAt) return res.status(404).json({ error: 'No encontrada' });
      res.json(u);
    } catch {
      res.status(400).json({ error: 'ID inválido' });
    }
  }
);

/* =========================================================================
   PATCH /units/:id
   ========================================================================= */
router.patch(
  '/:id',
  attachProjectByUnitId,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req, res) => {
    try {
      const update = { ...req.body };

      if (update.precioLista != null) update.price = update.precioLista;
      if (update.estado) update.status = String(update.estado).toUpperCase();

      if (update.manzana || update.lote) {
        const curr = await Unit.findById(req.params.id).select('manzana lote');
        const m = update.manzana ?? curr?.manzana ?? '';
        const l = update.lote ?? curr?.lote ?? '';
        update.code = `${m}-${l}`;
      }

      const u = await Unit.findByIdAndUpdate(
        req.params.id,
        { $set: update },
        { new: true }
      );

      if (!u) return res.status(404).json({ error: 'No encontrada' });

      // ✅ si cambia el precio de la unidad, sincronizamos también Venta.valor
      if (update.precioLista != null) {
        await Venta.updateOne(
          {
            tenantKey: req.tenantKey,
            projectId: u.projectId,
            unitId: u._id
          },
          {
            $set: { valor: Number(update.precioLista || 0) }
          }
        );
      }

      await syncProjectKpisSafe(req, u.projectId);

      res.json(u);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

/* =========================================================================
   DELETE /units/:id  (soft delete) => PIN
   ========================================================================= */
router.delete(
  '/:id',
  attachProjectByUnitId,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req, res) => {
    const bad = requirePin(req, res);
    if (bad) return;

    try {
      const now = new Date();

      const u = await Unit.findOneAndUpdate(
        {
          _id: req.params.id,
          tenantKey: req.tenantKey,
          projectId: req.project._id
        },
        { $set: { deletedAt: now } },
        { new: true }
      );

      if (!u) return res.status(404).json({ error: 'No encontrada' });

      // soft delete venta asociada
      await Venta.updateMany(
        {
          tenantKey: req.tenantKey,
          projectId: u.projectId,
          unitId: u._id,
          deletedAt: null
        },
        { $set: { deletedAt: now } }
      );

      await syncProjectKpisSafe(req, u.projectId);

      res.json({ success: true, id: u._id });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

module.exports = router;