const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

const Unit = require('../models/Unit');
const Project = require('../models/Project'); // ROLE-SEP
const requirePin = require('../utils/requirePin');

const { requireProjectAccess } = require('../middleware/rbac'); // ROLE-SEP

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
    req._unit = unit; // opcional
    next();
  } catch (e) {
    return res.status(400).json({ error: 'ID inválido' });
  }
}

/* =========================================================================
   POST /units/batch  (modo A: cantidad)
   - Admin/Bank: permitido
   - Promoter: permitido si asignado (según tu política: aquí lo permitimos)
   - Commercial: permitido (unidades) sólo si asignado
   ========================================================================= */
router.post(
  '/batch',
  attachProjectByProjectId,                                  // ROLE-SEP
  requireProjectAccess({ promoterCanEditAssigned: true }),   // ROLE-SEP (commercialOnlySales se cumple por isUnitsRoute)
  async (req, res) => {
    try {
      const { projectId, manzana, cantidad, modelo, m2, precioLista, estado } = req.body;
      if (!projectId || !manzana || !cantidad) {
        return res.status(400).json({ error: 'projectId, manzana y cantidad son requeridos' });
      }
      const lotes = Array.from({ length: parseInt(cantidad, 10) }, (_, i) => String(i + 1));
      const docs = lotes.map(lote => ({
        projectId, manzana, lote,
        modelo: modelo || '', m2: m2 || 0, precioLista: precioLista || 0,
        estado: estado || 'disponible',
        // legacy
        code: `${manzana}-${lote}`,
        status: (estado || 'disponible').toUpperCase(),
        price: precioLista || 0
      }));
      const created = await Unit.insertMany(docs, { ordered: false });
      res.json(created);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

/* =========================================================================
   GET /units  (filtros: projectId, estado, manzana, q)
   - Visibilidad: admin/bank → todas del tenant; promoter/commercial → sólo asignados (publishStatus: approved).
   ========================================================================= */
router.get(
  '/',
  attachProjectByProjectId,                 // ROLE-SEP
  requireProjectAccess(),                   // ROLE-SEP (lectura validada por asignación/aprobación)
  async (req, res) => {
    try {
      const { projectId, estado, manzana, q } = req.query;
      if (!projectId) return res.status(400).json({ error: 'projectId requerido' });

      const filter = { projectId, deletedAt: null };
      if (estado) filter.estado = estado;
      if (manzana) filter.manzana = manzana;
      const text = q ? { $or: [{ code: rx(q) }, { modelo: rx(q) }, { manzana: rx(q) }, { lote: rx(q) }] } : {};

      const list = await Unit.find({ ...filter, ...text }).populate('clienteId').sort({ manzana: 1, lote: 1 });
      res.json(list);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

/* =========================================================================
   GET /units/:id  (detalle)
   - Validamos acceso al proyecto dueño de la unidad.
   ========================================================================= */
router.get(
  '/:id',
  attachProjectByUnitId,     // ROLE-SEP
  requireProjectAccess(),    // ROLE-SEP
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
   - Admin/Bank: permitido
   - Promoter: permitido si asignado (promoterCanEditAssigned: true)
   - Commercial: permitido (unidades) sólo si asignado
   ========================================================================= */
router.patch(
  '/:id',
  attachProjectByUnitId,                                     // ROLE-SEP
  requireProjectAccess({ promoterCanEditAssigned: true }),   // ROLE-SEP
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
      const u = await Unit.findByIdAndUpdate(req.params.id, update, { new: true });
      if (!u) return res.status(404).json({ error: 'No encontrada' });
      res.json(u);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

/* =========================================================================
   DELETE /units/:id  (soft delete) => PIN
   - Admin/Bank: permitido
   - Promoter: permitido si asignado (según política; aquí permitido)
   - Commercial: permitido (unidades) sólo si asignado
   ========================================================================= */
router.delete(
  '/:id',
  attachProjectByUnitId,                                     // ROLE-SEP
  requireProjectAccess({ promoterCanEditAssigned: true }),   // ROLE-SEP
  async (req, res) => {
    const bad = requirePin(req, res);
    if (bad) return;
    try {
      const u = await Unit.findByIdAndUpdate(req.params.id, { deletedAt: new Date() }, { new: true });
      if (!u) return res.status(404).json({ error: 'No encontrada' });
      res.json({ success: true, id: u._id });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// PATCH /api/units/batch
router.patch(
  '/batch',
  attachProjectByProjectId,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req,res)=>{
    const { ids=[], update={} } = req.body||{};
    if (!ids.length) return res.status(400).json({ error:'ids requerido' });
    // Mantén la lógica espejo del PATCH individual:
    const set = { ...update };
    if (set.precioLista != null) set.price = set.precioLista;
    if (set.estado) set.status = String(set.estado).toUpperCase();

    // Si manzana/lote vienen en batch, recalcula code para cada una (hazlo simple: bulkWrite por id)
    const ops = ids.map(_id => ({ updateOne: { filter:{ _id }, update:{ $set: set } }}));
    const r = await Unit.bulkWrite(ops, { ordered:false });
    res.json({ matched: r.matchedCount, modified: r.modifiedCount });
  }
);

// DELETE /api/units/batch
router.delete(
  '/batch',
  attachProjectByProjectId,
  requireProjectAccess({ promoterCanEditAssigned: true }),
  async (req,res)=>{
    const bad = requirePin(req,res); if (bad) return;
    const { ids=[] } = req.body||{};
    if (!ids.length) return res.status(400).json({ error:'ids requerido' });
    const r = await Unit.updateMany({ _id: { $in: ids } }, { $set: { deletedAt: new Date() } });
    res.json({ modified: r.modifiedCount });
  }
);

module.exports = router;
