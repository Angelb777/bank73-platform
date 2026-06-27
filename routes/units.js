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

const VALID_UNIT_ESTADOS = [
  'disponible',
  'inventario',
  'reservado',
  'con_cpp',
  'tramite_legal_activado',
  'escriturado_traspasado',
  'vivienda_entregada',
  'cancelado'
];

function normalizeUnitEstado(estado) {
  const e = String(estado || '').trim();
  return VALID_UNIT_ESTADOS.includes(e) ? e : 'disponible';
}

function modelPayloadFromProject(project, modelIdOrName) {
  const models = Array.isArray(project?.housingModels) ? project.housingModels : [];
  const key = String(modelIdOrName || '').trim();
  if (!key) return null;
  const model = models.find(item =>
    String(item._id || '') === key ||
    String(item.name || '').trim().toLowerCase() === key.toLowerCase()
  );
  if (!model) return null;
  return {
    modelId: model._id || null,
    modelo: model.name || '',
    m2: Number(model.openAreaM2 || 0) + Number(model.closedAreaM2 || 0),
    areaAbierta: Number(model.openAreaM2 || 0),
    areaCerrada: Number(model.closedAreaM2 || 0),
    recamaras: Number(model.bedrooms || 0),
    banos: Number(model.bathrooms || 0),
    precioLista: Number(model.price || 0),
    price: Number(model.price || 0)
  };
}

function unitModelFieldsFromBody(project, body = {}) {
  const fromModel = modelPayloadFromProject(project, body.modelId || body.modelo);
  const out = fromModel ? { ...fromModel } : {};
  if (body.modelId !== undefined && !out.modelId && mongoose.Types.ObjectId.isValid(String(body.modelId))) {
    out.modelId = body.modelId;
  }
  if (body.modelo !== undefined) out.modelo = String(body.modelo || '').trim();
  if (body.m2 !== undefined) out.m2 = Number(body.m2 || 0);
  if (body.ubicacion !== undefined) {
    out.ubicacion = String(body.ubicacion || '').trim();
  } else if (!out.ubicacion) {
    out.ubicacion = String(project?.location || project?.address || '').trim();
  }
  if (body.precioLista !== undefined) {
    out.precioLista = Number(body.precioLista || 0);
    out.price = out.precioLista;
  }
  if (body.areaAbierta !== undefined) out.areaAbierta = Number(body.areaAbierta || 0);
  if (body.areaCerrada !== undefined) out.areaCerrada = Number(body.areaCerrada || 0);
  if (body.areaAbierta !== undefined || body.areaCerrada !== undefined) {
    out.areaTotalConstruccion = Number(out.areaAbierta || 0) + Number(out.areaCerrada || 0);
    if (!out.m2) out.m2 = out.areaTotalConstruccion;
  }
  if (body.recamaras !== undefined) out.recamaras = Number(body.recamaras || 0);
  if (body.banos !== undefined) out.banos = Number(body.banos || 0);
  return out;
}

const UNIT_VENTA_SYNC_FIELDS = [
  'numeroFinca',
  'codigoUbicacion',
  'calle',
  'loteEsquina',
  'metrosExtra',
  'precioLoteEsquina',
  'precioM2Extra',
  'areaAbierta',
  'areaCerrada',
  'areaTotalConstruccion',
  'recamaras',
  'banos',
  'valorMejoras',
  'valorTerreno'
];

function ventaSyncPayloadFromUnitSet(set = {}, fallback = {}) {
  const ventaSet = {};
  UNIT_VENTA_SYNC_FIELDS.forEach(field => {
    if (set[field] != null) ventaSet[field] = set[field];
  });
  if (set.ubicacion != null) ventaSet.ubicacion = String(set.ubicacion || '').trim();
  if (set.precioLista != null) {
    ventaSet.valor = Number(set.precioLista || 0);
    ventaSet.precioVenta = Number(set.precioLista || 0);
  }
  if (set.areaAbierta != null || set.areaCerrada != null) {
    ventaSet.areaTotalConstruccion =
      Number((set.areaAbierta ?? fallback.areaAbierta) || 0) +
      Number((set.areaCerrada ?? fallback.areaCerrada) || 0);
  }
  return ventaSet;
}

const ESTADOS_VENTA_CAIBLE = [
  'reservado',
  'con_cpp',
  'tramite_legal_activado',
  'escriturado_traspasado',
  'vivienda_entregada'
];

function esCambioAVentaCaida(estadoAnterior, estadoNuevo) {
  return (
    ESTADOS_VENTA_CAIBLE.includes(normalizeUnitEstado(estadoAnterior)) &&
    normalizeUnitEstado(estadoNuevo) === 'disponible'
  );
}

async function marcarVentaCaida({ tenantKey, projectId, unitId, motivo }) {
  await Venta.findOneAndUpdate(
    {
      tenantKey,
      projectId,
      unitId,
      deletedAt: null,
      estadoVenta: { $ne: 'caida' }
    },
    {
      $set: {
        estadoVenta: 'caida',
        fechaCaida: new Date(),
        motivoCaida: motivo || 'Unidad volvió a disponible'
      }
    },
    {
      sort: { updatedAt: -1 },
      new: true
    }
  );
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
      const { projectId, manzana, cantidad, estado } = req.body;
      if (!projectId || !manzana || !cantidad) {
        return res.status(400).json({ error: 'projectId, manzana y cantidad son requeridos' });
      }

      const lotes = Array.from({ length: parseInt(cantidad, 10) }, (_, i) => String(i + 1));
      const modelFields = unitModelFieldsFromBody(req.project, req.body);

      const docs = lotes.map(lote => ({
        tenantKey: req.tenantKey,
        projectId,
        manzana,
        lote,
        ...modelFields,
        ubicacion: modelFields.ubicacion || String(req.project?.location || req.project?.address || '').trim(),
        estado: normalizeUnitEstado(estado),
        deletedAt: null,

        // legacy
        code: `${manzana}-${lote}`,
        status: normalizeUnitEstado(estado).toUpperCase(),
        price: modelFields.precioLista || modelFields.price || 0
      }));

      const created = await Unit.insertMany(docs, { ordered: false });
      const ventas = created
        .filter(unit => unit.areaAbierta || unit.areaCerrada || unit.recamaras || unit.banos || unit.precioLista)
        .map(unit => ({
          tenantKey: req.tenantKey,
          projectId,
          unitId: unit._id,
          manzana: unit.manzana,
          lote: unit.lote,
          ubicacion: unit.ubicacion || req.project?.location || req.project?.address || '',
          areaAbierta: unit.areaAbierta || 0,
          areaCerrada: unit.areaCerrada || 0,
          areaTotalConstruccion: Number(unit.areaAbierta || 0) + Number(unit.areaCerrada || 0),
          recamaras: unit.recamaras || 0,
          banos: unit.banos || 0,
          precioVenta: unit.precioLista || 0,
          valor: unit.precioLista || 0
        }));
      if (ventas.length) await Venta.insertMany(ventas, { ordered: false });

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
      if (set.modelId || set.modelo) {
        Object.assign(set, unitModelFieldsFromBody(req.project, set));
      }
      if (set.precioLista != null) set.price = set.precioLista;

      let unitsAntes = [];

      if (set.estado) {
        set.estado = normalizeUnitEstado(set.estado);
        set.status = set.estado.toUpperCase();

        unitsAntes = await Unit.find({
          tenantKey: req.tenantKey,
          projectId: req.project._id,
          _id: { $in: ids }
        }).select('_id estado projectId');
      }

      const ops = ids.map(_id => ({
        updateOne: {
          filter: { _id },
          update: { $set: set }
        }
      }));

      const r = await Unit.bulkWrite(ops, { ordered: false });

            // ✅ Detectar ventas caídas en batch:
      // si una unidad estaba vendida/reservada y vuelve a disponible
      if (set.estado === 'disponible' && unitsAntes.length) {
        for (const oldUnit of unitsAntes) {
          if (esCambioAVentaCaida(oldUnit.estado, set.estado)) {
            await marcarVentaCaida({
              tenantKey: req.tenantKey,
              projectId: req.project._id,
              unitId: oldUnit._id,
              motivo: 'Cambio batch a disponible'
            });
          }
        }
      }

      // ✅ si cambia el precio de la unidad, sincronizamos también Venta.valor
      if (
        set.precioLista != null ||
        set.areaAbierta != null ||
        set.areaCerrada != null ||
        set.recamaras != null ||
        set.banos != null ||
        set.ubicacion != null ||
        UNIT_VENTA_SYNC_FIELDS.some(field => set[field] != null)
      ) {
        const ventaSet = ventaSyncPayloadFromUnitSet(set);
        await Venta.updateMany(
          {
            tenantKey: req.tenantKey,
            projectId: req.project._id,
            unitId: { $in: ids }
          },
          {
            $set: ventaSet
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
      const estadoAnterior = req._unit?.estado;

      if (update.modelId || update.modelo) {
        Object.assign(update, unitModelFieldsFromBody(req.project, update));
      }
      if (update.precioLista != null) update.price = update.precioLista;

      if (update.estado) {
        update.estado = normalizeUnitEstado(update.estado);
        update.status = update.estado.toUpperCase();
      }

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

            // ✅ Detectar venta caída individual:
      // si una unidad estaba vendida/reservada y vuelve a disponible
      if (update.estado && esCambioAVentaCaida(estadoAnterior, update.estado)) {
        await marcarVentaCaida({
          tenantKey: req.tenantKey,
          projectId: u.projectId,
          unitId: u._id,
          motivo: update.motivoCaida || 'Unidad volvió a disponible'
        });
      }
      

      // ✅ si cambia el precio de la unidad, sincronizamos también Venta.valor
      if (
        update.precioLista != null ||
        update.areaAbierta != null ||
        update.areaCerrada != null ||
        update.recamaras != null ||
        update.banos != null ||
        update.ubicacion != null ||
        UNIT_VENTA_SYNC_FIELDS.some(field => update[field] != null)
      ) {
        const ventaSet = ventaSyncPayloadFromUnitSet(update, req._unit || {});
        await Venta.findOneAndUpdate(
          {
            tenantKey: req.tenantKey,
            projectId: u.projectId,
            unitId: u._id
          },
          {
            $set: { ...ventaSet, tenantKey: req.tenantKey, projectId: u.projectId, unitId: u._id, deletedAt: null }
          },
          { upsert: true, new: true }
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
