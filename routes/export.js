// routes/export.js
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');

const Unit  = require('../models/Unit');
const Venta = require('../models/Venta');

// =========================
// CSV (Excel ES) helpers
// =========================
function toCSV(rows) {
  if (!rows || !rows.length) return '';

  const headers = Object.keys(rows[0]);

  const esc = (v) => {
    if (v == null) return '';
    const s = String(v).replace(/\r?\n/g, ' ').trim();
    // Excel ES: separador ;  -> escapamos si hay " ; o saltos
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const sep = ';';

  return [
    headers.join(sep),
    ...rows.map(r => headers.map(h => esc(r[h])).join(sep))
  ].join('\n');
}

function safeStr(v) {
  if (v == null) return '';
  return String(v).replace(/\r?\n/g, ' ').trim();
}
function toDateOrNull(d) {
  if (!d) return null;
  const x = new Date(d);
  return Number.isNaN(x.getTime()) ? null : x;
}
function numOr0(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function moneyOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function normalizeEstado(e) {
  const s = String(e || '').toLowerCase().trim();
  return s || 'disponible';
}

function estadoStyle(estado) {
  const e = normalizeEstado(estado);
  // ARGB: FF + RRGGBB
  if (e === 'entregado') return { fill: 'FFE8F5E9', font: 'FF1B5E20' };        // verde
  if (e === 'reservado') return { fill: 'FFFFF8E1', font: 'FF8D6E00' };        // ámbar
  if (e === 'en_escrituracion') return { fill: 'FFE3F2FD', font: 'FF0D47A1' }; // azul
  if (e === 'escriturado') return { fill: 'FFF3E5F5', font: 'FF4A148C' };      // morado
  return { fill: null, font: null };
}

// =========================
// Datos base (compartido)
// =========================
async function loadComercialData({ projectId, tenantKey }) {
  const unitFilter = {
    projectId: new mongoose.Types.ObjectId(projectId),
    deletedAt: null
  };
  if (tenantKey) unitFilter.tenantKey = tenantKey;

  const units = await Unit.find(unitFilter)
    .populate('clienteId')
    .sort({ manzana: 1, lote: 1 })
    .lean();

  const ventasFilter = { projectId: new mongoose.Types.ObjectId(projectId) };
  if (tenantKey) ventasFilter.tenantKey = tenantKey;

  const ventas = await Venta.find(ventasFilter).lean();
  const ventasMap = new Map((ventas || []).map(v => [String(v.unitId), v]));

  // filas “canon” para export
  const rows = (units || []).map(u => {
    const v = ventasMap.get(String(u._id)) || {};
    const unidad = `${safeStr(u.manzana)}-${safeStr(u.lote)}`.replace(/^-|-$/g, '');

    return {
      Unidad: unidad,
      Modelo: safeStr(u.modelo),
      Metros2: numOr0(u.m2),
      Estado: safeStr(u.estado),
      PrecioLista: numOr0(u.precioLista ?? u.price ?? 0),

      Cliente: safeStr(u.clienteId?.nombre || v.clienteNombre),
      Cedula: safeStr(v.cedula),
      Empresa: safeStr(v.empresa),
      ValorVenta: moneyOrNull(v.valor),

      Banco: safeStr(v.banco),
      OficialBanco: safeStr(v.oficialBanco),
      StatusBanco: safeStr(v.statusBanco),
      NumeroCPP: safeStr(v.numCPP),

      EntregaExpedienteBanco: toDateOrNull(v.entregaExpedienteBanco),
      RecibidoCPP: toDateOrNull(v.recibidoCPP),
      VencimientoCPP: toDateOrNull(v.fechaVencimientoCPP),
      FechaInscripcion: toDateOrNull(v.fechaInscripcion),
      CierreNotaria: toDateOrNull(v.cierreNotaria),

      Comentario: safeStr(v.comentario)
    };
  });

  return rows;
}

// =========================
// ✅ CSV: /api/export/comercial.csv
// =========================
router.get('/comercial.csv', async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId requerido' });

    const tenantKey = req.tenantKey;

    const rows = await loadComercialData({ projectId, tenantKey });

    // CSV espera strings, convertimos fechas a YYYY-MM-DD
    const rowsCsv = rows.map(r => ({
      ...r,
      EntregaExpedienteBanco: r.EntregaExpedienteBanco ? r.EntregaExpedienteBanco.toISOString().slice(0,10) : '',
      RecibidoCPP:            r.RecibidoCPP            ? r.RecibidoCPP.toISOString().slice(0,10) : '',
      VencimientoCPP:         r.VencimientoCPP         ? r.VencimientoCPP.toISOString().slice(0,10) : '',
      FechaInscripcion:       r.FechaInscripcion       ? r.FechaInscripcion.toISOString().slice(0,10) : '',
      CierreNotaria:          r.CierreNotaria          ? r.CierreNotaria.toISOString().slice(0,10) : '',
    }));

    const csv = toCSV(rowsCsv);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="comercial_${projectId}.csv"`);
    res.send('\ufeff' + csv); // BOM para acentos
  } catch (e) {
    console.error('[EXPORT comercial.csv] ERROR:', e);
    res.status(500).json({ error: e.message });
  }
});

// =========================
// ✅ XLSX PRO: /api/export/comercial.xlsx
// =========================
router.get('/comercial.xlsx', async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId requerido' });

    const tenantKey = req.tenantKey;
    const rows = await loadComercialData({ projectId, tenantKey });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Bank73';
    wb.created = new Date();

    const ws = wb.addWorksheet('Comercial', {
      views: [{ state: 'frozen', xSplit: 0, ySplit: 5 }] // congela título+meta+cabecera
    });

    // Título
    ws.mergeCells('A1:T1');
    const titleCell = ws.getCell('A1');
    titleCell.value = `Bank73 — Export Comercial`;
    titleCell.font = { bold: true, size: 16, color: { argb: 'FF0B1F3A' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' };

    // Meta
    ws.mergeCells('A2:T2');
    ws.getCell('A2').value = `ProjectId: ${projectId}${tenantKey ? ` | Tenant: ${tenantKey}` : ''}`;
    ws.getCell('A2').font = { size: 10, color: { argb: 'FF455A64' } };

    ws.mergeCells('A3:T3');
    ws.getCell('A3').value = `Generado: ${new Date().toISOString().replace('T',' ').slice(0,19)} UTC`;
    ws.getCell('A3').font = { size: 10, color: { argb: 'FF455A64' } };

    // fila separadora
    ws.getRow(4).height = 6;

    // Columnas
    const columns = [
      { header: 'Unidad', key: 'Unidad', width: 12 },
      { header: 'Modelo', key: 'Modelo', width: 14 },
      { header: 'Metros2', key: 'Metros2', width: 10 },
      { header: 'Estado', key: 'Estado', width: 14 },
      { header: 'PrecioLista', key: 'PrecioLista', width: 12 },

      { header: 'Cliente', key: 'Cliente', width: 22 },
      { header: 'Cedula', key: 'Cedula', width: 14 },
      { header: 'Empresa', key: 'Empresa', width: 16 },
      { header: 'ValorVenta', key: 'ValorVenta', width: 12 },

      { header: 'Banco', key: 'Banco', width: 16 },
      { header: 'OficialBanco', key: 'OficialBanco', width: 18 },
      { header: 'StatusBanco', key: 'StatusBanco', width: 16 },
      { header: 'NumeroCPP', key: 'NumeroCPP', width: 14 },

      { header: 'EntregaExpedienteBanco', key: 'EntregaExpedienteBanco', width: 18 },
      { header: 'RecibidoCPP', key: 'RecibidoCPP', width: 14 },
      { header: 'VencimientoCPP', key: 'VencimientoCPP', width: 14 },
      { header: 'FechaInscripcion', key: 'FechaInscripcion', width: 14 },
      { header: 'CierreNotaria', key: 'CierreNotaria', width: 14 },

      { header: 'Comentario', key: 'Comentario', width: 28 }
    ];
    ws.columns = columns;

    // Cabecera en fila 5
    const headerRowIndex = 5;
    ws.getRow(headerRowIndex).values = columns.map(c => c.header);
    const headerRow = ws.getRow(headerRowIndex);
    headerRow.height = 22;
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };

    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B1F3A' } };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFCFD8DC' } },
        left: { style: 'thin', color: { argb: 'FFCFD8DC' } },
        bottom: { style: 'thin', color: { argb: 'FFCFD8DC' } },
        right: { style: 'thin', color: { argb: 'FFCFD8DC' } }
      };
    });

    // Datos desde fila 6
    const startDataRow = headerRowIndex + 1;

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const row = ws.addRow(r);

      // zebra
      const isOdd = i % 2 === 1;
      const zebraFill = isOdd ? 'FFF7F9FC' : null;

      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
        };

        // wrap en texto largo
        const wrapCols = [6, 8, 11, 19];
        if (wrapCols.includes(colNumber)) {
          cell.alignment = { vertical: 'top', horizontal: 'left', wrapText: true };
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
        }

        if (zebraFill) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebraFill } };
        }
      });

      // Estado color (col 4)
      const st = estadoStyle(r.Estado);
      if (st.fill) {
        const stateCell = row.getCell(4);
        stateCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: st.fill } };
        stateCell.font = { color: { argb: st.font }, bold: true };
        stateCell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      }

      // formatos numéricos
      row.getCell(3).numFmt = '0';
      row.getCell(3).alignment = { vertical: 'middle', horizontal: 'right' };

      row.getCell(5).numFmt = '#,##0.00';
      row.getCell(5).alignment = { vertical: 'middle', horizontal: 'right' };

      row.getCell(9).numFmt = '#,##0.00';
      row.getCell(9).alignment = { vertical: 'middle', horizontal: 'right' };

      // fechas 14..18
      for (const c of [14, 15, 16, 17, 18]) {
        const cell = row.getCell(c);
        if (cell.value instanceof Date) {
          cell.numFmt = 'yyyy-mm-dd';
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        }
      }
    }

    // filtro cabecera
    ws.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex, column: columns.length }
    };

    // auto width con límites
    columns.forEach((col, idx) => {
      const colIndex = idx + 1;
      let maxLen = col.header.length;

      ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber < startDataRow) return;
        const v = row.getCell(colIndex).value;
        const s =
          v instanceof Date ? 'yyyy-mm-dd' :
          v == null ? '' :
          String(v);
        maxLen = Math.max(maxLen, s.length);
      });

      ws.getColumn(colIndex).width = clamp(maxLen + 2, col.width || 10, 45);
    });

    const filename = `comercial_${projectId}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (e) {
    console.error('[EXPORT comercial.xlsx] ERROR:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
