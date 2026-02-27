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

function numOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function moneyOrNull(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

function yesNo(v) {
  return v ? 'SI' : 'NO';
}

function fmtDateDMY(d) {
  if (!d) return '';
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return '';
  const dd = String(x.getUTCDate()).padStart(2,'0');
  const mm = String(x.getUTCMonth()+1).padStart(2,'0');
  const yyyy = String(x.getUTCFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function colLetter(n) {
  // 1 -> A
  let s = '';
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
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

  // ✅ Cabeceras EXACTAS del Excel "DATO UNICO EXPEDIENTES EJEMPLO.xlsx"
  const rows = (units || []).map(u => {
    const v = ventasMap.get(String(u._id)) || {};

    return {
      'LOTE': safeStr(u.lote || v.lote),
      'MANZANA': safeStr(u.manzana || v.manzana),

      'CLIENTE': safeStr(u.clienteId?.nombre || v.clienteNombre),
      'CEDULA': safeStr(v.cedula),
      'EMPRESA': safeStr(v.empresa),

      'BANCO': safeStr(v.banco),
      'ENTREGA DE EXPEDIENTE A BANCO': toDateOrNull(v.entregaExpedienteBanco),
      'OFICIAL DE BANCO': safeStr(v.oficialBanco),
      'STATUS EN BANCO': safeStr(v.statusBanco),
      'N° CPP': safeStr(v.numCPP),
      'RECIBIDO DE CPP': toDateOrNull(v.recibidoCPP),
      'PLAZO APROBACION': numOrNull(v.plazoAprobacionDias),
      'FECHA VALOR DE CPP': toDateOrNull(v.fechaValorCPP),
      'FECHA DE VENCIMIENTO CCP': toDateOrNull(v.fechaVencimientoCPP),
      'VALOR': moneyOrNull(v.valor),

      // ✅ nuevas (SI/NO) + tiempo
      'APERTURA CTA BANCO': yesNo(!!v.aperturaCtaBanco),
      '1RA MENSUAL': yesNo(!!v.primeraMensual),
      'PAGO MINUTA': yesNo(!!v.pagoMinuta),

      'FECHA CONTRATO FIRMADO POR CLIENTE': toDateOrNull(v.fechaContratoCliente),
      'ESTATUS CTTO': safeStr(v.estatusContrato),

      'EXPEDIENTE MIVI          ': safeStr(v.expedienteMIVI), // respeta espacios del header original
      'FECHA DE ENTREGA DE EXPEDIENTE MIVI': toDateOrNull(v.entregaExpMIVI),
      'N° DE RESOLUCION MIVI': safeStr(v.resolucionMIVI),
      'FECHA RESOLUCION': toDateOrNull(v.fechaResolucionMIVI),

      'TIEMPO DE APROBACION': numOrNull(v.tiempoAprobacionDias),
      'VENCIMIENTO CPP BN-MIVI': toDateOrNull(v.vencimientoCPPBnMivi),

      'M. DE LIBERACION': safeStr(v.mLiberacion),
      'M. SEGREGACION': safeStr(v.mSegregacion),
      'M. PRESTAMO': safeStr(v.mPrestamo),

      'SOLICITUD DE AVALUO': safeStr(v.solicitudAvaluo),
      'AVALUO REALIZADO': safeStr(v.avaluoRealizado),

      'EN CONSTRUCCION': yesNo(!!v.enConstruccion),
      'FASE CONSTRUCCION': safeStr(v.faseConstruccion),
      'PERMISOS DE CONSTRUCCION N° RESOLUCION': safeStr(v.permisoConstruccionNum),
      'PERMISO DE OCUPACIÓN': yesNo(!!v.permisoOcupacion),
      'N° PERMISO DE OCUPACION': safeStr(v.permisoOcupacionNum),
      'CONSTUCTOR': safeStr(v.constructora), // en Excel está mal escrito así

      'PAZ Y SALVO GESPROBAN': yesNo(!!v.pazSalvoGesproban),
      'PAZ Y SALVO PROMOTORA': yesNo(!!v.pazSalvoPromotora),

      'PAGARE': safeStr(v.pagare),
      'FECHA FIRMA': toDateOrNull(v.fechaFirma),

      'PROTOCOLO FIRMA DE CLIENTE': yesNo(!!v.protocoloFirmaCliente),
      'FECHA DE ENTREGA A BANCO': toDateOrNull(v.fechaEntregaBanco),
      'PROTOC. FIRMA DE RL, BANCO INTER': yesNo(!!v.protocoloFirmaRLBancoInter),
      'FECHA REGRESO BANCO': toDateOrNull(v.fechaRegresoBanco),

      // Excel tiene 3 "DIAS TRANSCURRIDOS"
      'DIAS TRANSCURRIDOS': numOrNull(v.diasTranscurridosBanco),

      'FECHA ENTREGA PROTOCOLO BANCO CLIENTE': toDateOrNull(v.fechaEntregaProtocoloBancoCli),
      'FIRMA PROTOC. BANCO CLIENT': yesNo(!!v.firmaProtocoloBancoCliente),
      'FECHA REGRESO PROTOCOLO BANCO CLIENTE': toDateOrNull(v.fechaRegresoProtocoloBancoCli),

      // segundo DIAS
      'DIAS TRANSCURRIDOS ': numOrNull(v.diasTranscurridosProtocolo), // ojo: clave distinta (espacio) para no pisar

      // estos 3 en tu modelo final son boolean (SI/NO)
      'CIERRE DE NOTARIA': yesNo(!!v.cierreNotaria),
      'FECHA DE PAGO DE IMPUESTO': toDateOrNull(v.fechaPagoImpuesto),
      'INGRESO AL RP': yesNo(!!v.ingresoRP),
      'FECHA DE INSCRIPCION': toDateOrNull(v.fechaInscripcion),

      'SOLICITUD DE DESEMBOLSO': yesNo(!!v.solicitudDesembolso),
      'FECHA DE RECIBIDO DE CK': toDateOrNull(v.fechaRecibidoCheque),

      'SOLICITUD MIVI DESEMBOLSO': toDateOrNull(v.solicitudMiviDesembolso),
      'DESEMBOLSO MIVI': safeStr(v.desembolsoMivi),
      'FECHA DE PAGO MIVI': toDateOrNull(v.fechaPagoMivi),

      // tercer DIAS TRANSCURRIDOS (no existe en tu schema → lo dejamos vacío)
      'DIAS TRANSCURRIDOS  ': null,

      'ENTREGA DE CASA': safeStr(v.entregaCasa),
      'ENTREGA ANATI': safeStr(v.entregaANATI),
      'COMENTARIO': safeStr(v.comentario),
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

    // CSV: fechas a dd/mm/yyyy
    const dateKeys = [
      'ENTREGA DE EXPEDIENTE A BANCO',
      'RECIBIDO DE CPP',
      'FECHA VALOR DE CPP',
      'FECHA DE VENCIMIENTO CCP',
      'FECHA CONTRATO FIRMADO POR CLIENTE',
      'FECHA DE ENTREGA DE EXPEDIENTE MIVI',
      'FECHA RESOLUCION',
      'VENCIMIENTO CPP BN-MIVI',
      'FECHA FIRMA',
      'FECHA DE ENTREGA A BANCO',
      'FECHA REGRESO BANCO',
      'FECHA ENTREGA PROTOCOLO BANCO CLIENTE',
      'FECHA REGRESO PROTOCOLO BANCO CLIENTE',
      'FECHA DE PAGO DE IMPUESTO',
      'FECHA DE INSCRIPCION',
      'FECHA DE RECIBIDO DE CK',
      'SOLICITUD MIVI DESEMBOLSO',
      'FECHA DE PAGO MIVI',
    ];

    const rowsCsv = rows.map(r => {
      const x = { ...r };
      for (const k of dateKeys) x[k] = x[k] ? fmtDateDMY(x[k]) : '';
      return x;
    });

    const csv = toCSV(rowsCsv);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="comercial_${projectId}.csv"`);
    res.send('\ufeff' + csv);
  } catch (e) {
    console.error('[EXPORT comercial.csv] ERROR:', e);
    res.status(500).json({ error: e.message });
  }
});

// =========================
// ✅ XLSX: /api/export/comercial.xlsx
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
      views: [{ state: 'frozen', xSplit: 0, ySplit: 5 }]
    });

    // Columnas (mismo orden que keys del row)
    const headers = rows[0] ? Object.keys(rows[0]) : [];
    const columns = headers.map(h => ({ header: h, key: h, width: Math.min(Math.max(h.length + 2, 12), 45) }));
    ws.columns = columns;

    // Ajuste merges dinámicos (A..end)
    const endCol = colLetter(Math.max(columns.length, 1));

    // Título
    ws.mergeCells(`A1:${endCol}1`);
    ws.getCell('A1').value = `Bank73 — Export Comercial (Formato Dato Único)`;
    ws.getCell('A1').font = { bold: true, size: 16, color: { argb: 'FF0B1F3A' } };
    ws.getCell('A1').alignment = { vertical: 'middle', horizontal: 'left' };

    // Meta
    ws.mergeCells(`A2:${endCol}2`);
    ws.getCell('A2').value = `ProjectId: ${projectId}${tenantKey ? ` | Tenant: ${tenantKey}` : ''}`;
    ws.getCell('A2').font = { size: 10, color: { argb: 'FF455A64' } };

    ws.mergeCells(`A3:${endCol}3`);
    ws.getCell('A3').value = `Generado: ${new Date().toISOString().replace('T',' ').slice(0,19)} UTC`;
    ws.getCell('A3').font = { size: 10, color: { argb: 'FF455A64' } };

    ws.getRow(4).height = 6;

    // Cabecera (fila 5)
    const headerRowIndex = 5;
    ws.getRow(headerRowIndex).values = columns.map(c => c.header);
    const headerRow = ws.getRow(headerRowIndex);
    headerRow.height = 26;
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

    const startDataRow = headerRowIndex + 1;

    // Identificar columnas que son fecha para formato dd/mm/yyyy
    const dateCols = new Set([
      'ENTREGA DE EXPEDIENTE A BANCO',
      'RECIBIDO DE CPP',
      'FECHA VALOR DE CPP',
      'FECHA DE VENCIMIENTO CCP',
      'FECHA CONTRATO FIRMADO POR CLIENTE',
      'FECHA DE ENTREGA DE EXPEDIENTE MIVI',
      'FECHA RESOLUCION',
      'VENCIMIENTO CPP BN-MIVI',
      'FECHA FIRMA',
      'FECHA DE ENTREGA A BANCO',
      'FECHA REGRESO BANCO',
      'FECHA ENTREGA PROTOCOLO BANCO CLIENTE',
      'FECHA REGRESO PROTOCOLO BANCO CLIENTE',
      'FECHA DE PAGO DE IMPUESTO',
      'FECHA DE INSCRIPCION',
      'FECHA DE RECIBIDO DE CK',
      'SOLICITUD MIVI DESEMBOLSO',
      'FECHA DE PAGO MIVI',
    ]);

    // Render filas
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const row = ws.addRow(r);

      const isOdd = i % 2 === 1;
      const zebraFill = isOdd ? 'FFF7F9FC' : null;

      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          left: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } },
          right: { style: 'thin', color: { argb: 'FFE0E0E0' } }
        };

        if (zebraFill) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: zebraFill } };
        }

        // wrap para textos largos
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: false };
      });

      // Formato fechas
      for (let c = 1; c <= columns.length; c++) {
        const key = columns[c - 1].key;
        if (!dateCols.has(key)) continue;

        const cell = row.getCell(c);
        if (cell.value instanceof Date) {
          cell.numFmt = 'dd/mm/yyyy';
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        } else {
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        }
      }

      // Formato numérico para VALOR
      const idxValor = headers.indexOf('VALOR') + 1;
      if (idxValor > 0) {
        const c = row.getCell(idxValor);
        if (typeof c.value === 'number') {
          c.numFmt = '#,##0.00';
          c.alignment = { vertical: 'middle', horizontal: 'right' };
        }
      }
    }

    // Filtro
    ws.autoFilter = {
      from: { row: headerRowIndex, column: 1 },
      to: { row: headerRowIndex, column: columns.length }
    };

    // Auto width con límites
    columns.forEach((col, idx) => {
      const colIndex = idx + 1;
      let maxLen = col.header.length;

      ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber < startDataRow) return;
        const v = row.getCell(colIndex).value;
        const s =
          v instanceof Date ? 'dd/mm/yyyy' :
          v == null ? '' :
          String(v);
        maxLen = Math.max(maxLen, s.length);
      });

      ws.getColumn(colIndex).width = clamp(maxLen + 2, col.width || 12, 55);
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