'use strict';

const express = require('express');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');

const Unit = require('../models/Unit');
const Venta = require('../models/Venta');
const Project = require('../models/Project');
const { requireProjectAccess } = require('../middleware/rbac');
const {
  DATO_UNICO_HEADERS,
  DATO_UNICO_DATE_HEADERS,
  DATO_UNICO_MONEY_HEADERS,
  DATO_UNICO_GROUPS,
  buildDatoUnicoExportRow
} = require('../services/datoUnicoExport');

const router = express.Router();

function csvEscape(value) {
  if (value == null) return '';
  const stringValue = String(value).replace(/\r?\n/g, ' ');
  return /[";\n]/.test(stringValue)
    ? `"${stringValue.replace(/"/g, '""')}"`
    : stringValue;
}

function toCSV(rows) {
  return [
    DATO_UNICO_HEADERS.map(csvEscape).join(';'),
    ...rows.map(row => DATO_UNICO_HEADERS.map(header => csvEscape(row[header])).join(';'))
  ].join('\n');
}

function fmtDateDMY(value) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  const day = String(parsed.getUTCDate()).padStart(2, '0');
  const month = String(parsed.getUTCMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${parsed.getUTCFullYear()}`;
}

function clamp(number, min, max) {
  return Math.max(min, Math.min(max, number));
}

function colLetter(number) {
  let result = '';
  while (number > 0) {
    const remainder = (number - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    number = Math.floor((number - 1) / 26);
  }
  return result;
}

async function validateTenantProject(projectId, tenantKey) {
  if (!mongoose.Types.ObjectId.isValid(String(projectId || ''))) return null;
  return Project.findOne({ _id: projectId, tenantKey }).select('_id').lean();
}

async function loadComercialData({ projectId, tenantKey }) {
  const objectProjectId = new mongoose.Types.ObjectId(projectId);
  const unitFilter = { projectId: objectProjectId, deletedAt: null };
  const ventasFilter = { projectId: objectProjectId, deletedAt: null };
  if (tenantKey) {
    unitFilter.tenantKey = tenantKey;
    ventasFilter.tenantKey = tenantKey;
  }

  const [units, ventas] = await Promise.all([
    Unit.find(unitFilter)
      .populate('clienteId')
      .populate('folderId')
      .sort({ folderId: 1, folderOrder: 1, etapa: 1, torre: 1, nivel: 1, manzana: 1, lote: 1 })
      .lean(),
    Venta.find(ventasFilter).lean()
  ]);

  const ventasMap = new Map((ventas || []).map(venta => [String(venta.unitId), venta]));
  return (units || []).map(unit => (
    buildDatoUnicoExportRow(unit, ventasMap.get(String(unit._id)) || {})
  ));
}

function styleDatoUnicoWorksheet(worksheet, rows) {
  const endColumn = colLetter(DATO_UNICO_HEADERS.length);
  worksheet.columns = DATO_UNICO_HEADERS.map(header => ({
    key: header,
    width: clamp(header.length + 2, 12, 38)
  }));

  worksheet.mergeCells(`A1:${endColumn}1`);
  const titleCell = worksheet.getCell('A1');
  titleCell.value = 'DATO ÚNICO';
  titleCell.font = { bold: true, size: 16, color: { argb: 'FFFFFFFF' } };
  titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF17365D' } };
  titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
  worksheet.getRow(1).height = 26;

  for (const group of DATO_UNICO_GROUPS) {
    worksheet.mergeCells(2, group.from, 2, group.to);
    const cell = worksheet.getCell(2, group.from);
    cell.value = group.title;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  }
  const commentsGroupCell = worksheet.getCell(2, DATO_UNICO_HEADERS.length);
  commentsGroupCell.value = 'OBSERVACIONES';
  commentsGroupCell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  commentsGroupCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
  commentsGroupCell.alignment = { vertical: 'middle', horizontal: 'center' };
  worksheet.getRow(2).height = 24;

  const headerRow = worksheet.getRow(3);
  headerRow.values = DATO_UNICO_HEADERS;
  headerRow.height = 42;
  headerRow.eachCell({ includeEmpty: true }, cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF203864' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    cell.border = {
      top: { style: 'thin', color: { argb: 'FFD9E2F3' } },
      left: { style: 'thin', color: { argb: 'FFD9E2F3' } },
      bottom: { style: 'thin', color: { argb: 'FFD9E2F3' } },
      right: { style: 'thin', color: { argb: 'FFD9E2F3' } }
    };
  });

  rows.forEach((data, index) => {
    const row = worksheet.addRow(data);
    const fillColor = index % 2 ? 'FFF2F6FC' : null;
    row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
      const header = DATO_UNICO_HEADERS[columnNumber - 1];
      cell.alignment = {
        vertical: 'middle',
        horizontal: DATO_UNICO_DATE_HEADERS.has(header) ? 'center' : 'left'
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFE7E6E6' } },
        left: { style: 'thin', color: { argb: 'FFE7E6E6' } },
        bottom: { style: 'thin', color: { argb: 'FFE7E6E6' } },
        right: { style: 'thin', color: { argb: 'FFE7E6E6' } }
      };
      if (fillColor) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fillColor } };
      }
      if (DATO_UNICO_DATE_HEADERS.has(header) && cell.value instanceof Date) {
        cell.numFmt = 'dd/mm/yyyy';
      }
      if (DATO_UNICO_MONEY_HEADERS.has(header) && typeof cell.value === 'number') {
        cell.numFmt = '#,##0.00';
      }
      if (header === 'PORCENTAJE DE FINANCIAMIENTO2' && typeof cell.value === 'number') {
        cell.numFmt = '0.00';
      }
    });
  });

  DATO_UNICO_HEADERS.forEach((header, index) => {
    let maxLength = header.length;
    for (const row of rows) {
      const value = row[header];
      const display = value instanceof Date ? 'dd/mm/yyyy' : String(value ?? '');
      maxLength = Math.max(maxLength, display.length);
    }
    worksheet.getColumn(index + 1).width = clamp(maxLength + 2, 12, 38);
  });

  worksheet.views = [{ state: 'frozen', xSplit: 4, ySplit: 3 }];
  worksheet.autoFilter = {
    from: { row: 3, column: 1 },
    to: { row: 3, column: DATO_UNICO_HEADERS.length }
  };
}

router.get('/comercial.csv', requireProjectAccess(), async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId requerido' });

    const tenantKey = req.tenantKey;
    const project = await validateTenantProject(projectId, tenantKey);
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const rows = await loadComercialData({ projectId, tenantKey });
    const csvRows = rows.map(row => {
      const formatted = { ...row };
      for (const header of DATO_UNICO_DATE_HEADERS) {
        if (formatted[header] instanceof Date) {
          formatted[header] = fmtDateDMY(formatted[header]);
        }
      }
      return formatted;
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="comercial_${projectId}.csv"`);
    return res.send('\ufeff' + toCSV(csvRows));
  } catch (error) {
    console.error('[EXPORT comercial.csv] ERROR:', error);
    return res.status(500).json({ error: error.message });
  }
});

router.get('/comercial.xlsx', requireProjectAccess(), async (req, res) => {
  try {
    const { projectId } = req.query;
    if (!projectId) return res.status(400).json({ error: 'projectId requerido' });

    const tenantKey = req.tenantKey;
    const project = await validateTenantProject(projectId, tenantKey);
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const rows = await loadComercialData({ projectId, tenantKey });
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Bank73';
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet('EXPEDIENTES-BANCO');
    styleDatoUnicoWorksheet(worksheet, rows);

    const filename = `comercial_${projectId}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await workbook.xlsx.write(res);
    return res.end();
  } catch (error) {
    console.error('[EXPORT comercial.xlsx] ERROR:', error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
module.exports._test = { loadComercialData, styleDatoUnicoWorksheet, toCSV };
