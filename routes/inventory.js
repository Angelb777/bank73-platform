// routes/inventory.js
const express = require('express');
const router = express.Router();

let Unit;
try {
  Unit = require('../models/Unit'); // usará tu modelo si existe
} catch {
  Unit = null;
}

/**
 * GET /api/inventory/:projectId
 * Respuesta legada: array de { _id, code, status, price }
 */
router.get('/:projectId', async (req, res) => {
  const { projectId } = req.params;
  if (!projectId) return res.status(400).json({ error: 'projectId requerido' });

  // Si no hay modelo Unit, entregamos vacío pero sin romper
  if (!Unit) return res.json([]);

  try {
    const docs = await Unit.find({ projectId, deletedAt: null }).select('_id code status price').sort({ code: 1 });
    res.json(docs || []);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/inventory/seed
 * Body: { projectId, manzana="A", cantidad=5, precio=100000 }
 * Crea unidades rápidas de prueba (solo para recuperar la vista).
 */
router.post('/seed', async (req, res) => {
  if (!Unit) return res.status(500).json({ error: 'Modelo Unit no encontrado' });

  try {
    const { projectId, manzana = 'A', cantidad = 5, precio = 100000 } = req.body || {};
    if (!projectId) return res.status(400).json({ error: 'projectId requerido' });

    const loteNums = Array.from({ length: Number(cantidad) || 0 }, (_, i) => i + 1);
    const docs = loteNums.map(n => ({
      projectId,
      manzana,
      lote: String(n),
      code: `${manzana}-${n}`,
      status: 'DISPONIBLE',
      price: precio,
      // campos nuevos si tu schema los tiene:
      estado: 'disponible',
      precioLista: precio
    }));

    const created = await Unit.insertMany(docs, { ordered: false });
    res.json({ created: created.length });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

module.exports = router;
