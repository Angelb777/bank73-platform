const express = require('express');
const router = express.Router();
const Unit = require('../models/Unit');

function toCSV(rows) {
  if (!rows.length) return '';
  const headers = Object.keys(rows[0]);
  const esc = v => {
    if (v == null) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n');
}

// GET /export/comercial.csv?projectId=...
router.get('/comercial.csv', async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId requerido' });

    const units = await Unit.find({ projectId, deletedAt: null }).populate('clienteId').sort({ manzana: 1, lote: 1 });
    const rows = units.map(u => ({
      unidad: `${u.manzana || ''}-${u.lote || ''}`,
      modelo: u.modelo || '',
      m2: u.m2 || 0,
      estado: u.estado || '',
      precioLista: u.precioLista || u.price || 0,
      cliente: u.clienteId?.nombre || ''
    }));

    const csv = toCSV(rows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="comercial.csv"');
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
