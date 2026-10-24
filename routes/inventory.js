// routes/inventory.js
const express = require('express');
const router = express.Router();

let Unit;
const Venta = require('../models/Venta');
const Project = require('../models/Project');
const { requireProjectAccess } = require('../middleware/rbac');
try {
  Unit = require('../models/Unit'); // usará tu modelo si existe
} catch {
  Unit = null;
}

/**
 * GET /api/inventory/:projectId
 * Respuesta legada: array de { _id, code, status, price }
 */
router.get('/:projectId', requireProjectAccess(), async (req, res) => {
  const { projectId } = req.params;
  if (!projectId) return res.status(400).json({ error: 'projectId requerido' });

  // Si no hay modelo Unit, entregamos vacío pero sin romper
  if (!Unit) return res.json([]);

  try {
    const [docs, sales] = await Promise.all([
      Unit.find({ tenantKey: req.tenantKey, projectId, deletedAt: null }).select('_id code status').sort({ code: 1 }).lean(),
      Venta.find({ tenantKey: req.tenantKey, projectId, deletedAt: null }).select('unitId precioVenta').lean()
    ]);
    const prices = new Map(sales.map(sale => [String(sale.unitId), Number(sale.precioVenta || 0)]));
    res.json((docs || []).map(unit => ({ ...unit, price: prices.get(String(unit._id)) || 0 })));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/inventory/seed
 * Body: { projectId, manzana="A", cantidad=5, precio=100000 }
 * Crea unidades rápidas de prueba (solo para recuperar la vista).
 */
router.post('/seed', requireProjectAccess({ promoterCanEditAssigned: true }), async (req, res) => {
  if (!Unit) return res.status(500).json({ error: 'Modelo Unit no encontrado' });

  try {
    const { projectId, manzana = 'A', cantidad = 5, precio = 100000 } = req.body || {};
    if (!projectId) return res.status(400).json({ error: 'projectId requerido' });
    const project = await Project.findOne({ _id: projectId, tenantKey: req.tenantKey }).select('_id').lean();
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const loteNums = Array.from({ length: Number(cantidad) || 0 }, (_, i) => i + 1);
    const docs = loteNums.map(n => ({
      tenantKey: req.tenantKey,
      projectId,
      manzana,
      lote: String(n),
      code: `${manzana}-${n}`,
      status: 'DISPONIBLE',
      // campos nuevos si tu schema los tiene:
      estado: 'disponible',
      estadoModo: 'automatico',
      estadoAutomaticoSugerido: 'disponible',
      estadoAutomaticoBase: 'disponible',
      estadoAutomaticoMotivo: 'Unidad nueva sin avance comercial'
    }));

    const created = await Unit.insertMany(docs, { ordered: false });
    await Venta.insertMany(created.map(unit => ({ tenantKey:req.tenantKey, projectId, unitId:unit._id, manzana:unit.manzana, lote:unit.lote, precioVenta:Number(precio || 0) })), { ordered:false });
    res.json({ created: created.length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
