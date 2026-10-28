'use strict';

const ExcelJS = require('exceljs');
const {
  DATO_UNICO_HEADERS,
  DATO_UNICO_DATE_HEADERS,
  DATO_UNICO_MONEY_HEADERS,
  DATO_UNICO_GROUPS
} = require('./datoUnicoExport');
const { addNativeCharts } = require('./nativeXlsxCharts');

const COLORS = {
  navy: 'FF0F2747', blue: 'FF1D4E89', blueSoft: 'FFEAF1FA', green: 'FF0F766E',
  greenSoft: 'FFECFDF5', purple: 'FF7C3AED', purpleSoft: 'FFF3E8FF', amber: 'FFD97706',
  amberSoft: 'FFFFF7E6', red: 'FFB91C1C', slate: 'FF64748B', slateSoft: 'FFF1F5F9', white: 'FFFFFFFF'
};
const PALETTE = ['2F75B5', '00A6A6', '8064A2', 'F4B183', '70AD47', 'C55A11'];

function colLetter(number) {
  let result = '';
  for (let n = number; n > 0; n = Math.floor((n - 1) / 26)) {
    result = String.fromCharCode(65 + ((n - 1) % 26)) + result;
  }
  return result;
}

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
}

function numberValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const text = String(value || '').replace(/,/g, '');
  const money = /B\/\.\s*([\d.]+)\s*([kKmM])?/.exec(text);
  if (money) {
    const multiplier = String(money[2] || '').toLowerCase() === 'm' ? 1e6 : String(money[2] || '').toLowerCase() === 'k' ? 1e3 : 1;
    return Number(money[1]) * multiplier;
  }
  const match = /-?[\d.]+/.exec(text);
  return match ? Number(match[0]) || 0 : 0;
}

function styleTitle(ws, title, subtitle, endColumn) {
  ws.mergeCells(1, 1, 1, endColumn);
  ws.getCell(1, 1).value = title;
  ws.getCell(1, 1).font = { name: 'Arial', bold: true, size: 16, color: { argb: COLORS.navy } };
  ws.getRow(1).height = 28;
  ws.mergeCells(2, 1, 2, endColumn);
  ws.getCell(2, 1).value = subtitle;
  ws.getCell(2, 1).font = { name: 'Arial', italic: true, size: 9, color: { argb: COLORS.slate } };
  ws.getRow(2).height = 20;
  for (let column = 1; column <= endColumn; column += 1) {
    ws.getCell(3, column).border = { bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } } };
  }
}

function styleSection(ws, row, title, endColumn, fill = COLORS.blueSoft) {
  ws.mergeCells(row, 1, row, endColumn);
  const cell = ws.getCell(row, 1);
  cell.value = title;
  cell.font = { name: 'Arial', bold: true, size: 11, color: { argb: COLORS.navy } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  cell.alignment = { vertical: 'middle' };
  ws.getRow(row).height = 24;
}

function styleDatoUnicoSheet(ws, rows) {
  const endColumn = colLetter(DATO_UNICO_HEADERS.length);
  ws.mergeCells(`A1:${endColumn}1`);
  ws.getCell('A1').value = 'DATO ÚNICO';
  ws.getCell('A1').font = { name: 'Arial', bold: true, size: 16, color: { argb: COLORS.white } };
  ws.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
  ws.getCell('A1').alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 27;

  for (const group of DATO_UNICO_GROUPS) {
    ws.mergeCells(2, group.from, 2, group.to);
    const cell = ws.getCell(2, group.from);
    cell.value = group.title;
    cell.font = { name: 'Arial', bold: true, size: 9, color: { argb: COLORS.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.blue } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }
  ws.getCell(2, DATO_UNICO_HEADERS.length).value = 'OBSERVACIONES';
  ws.getCell(2, DATO_UNICO_HEADERS.length).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.blue } };
  ws.getCell(2, DATO_UNICO_HEADERS.length).font = { name: 'Arial', bold: true, size: 9, color: { argb: COLORS.white } };

  const tableRows = rows.map(row => DATO_UNICO_HEADERS.map(header => row[header] == null ? null : row[header]));
  ws.addTable({
    name: 'DatoUnicoTable', ref: 'A3', headerRow: true,
    style: { theme: 'TableStyleMedium2', showRowStripes: true },
    columns: DATO_UNICO_HEADERS.map(name => ({ name })), rows: tableRows
  });
  ws.getRow(3).height = 42;
  ws.getRow(3).font = { name: 'Arial', bold: true, size: 9, color: { argb: COLORS.white } };
  ws.getRow(3).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  DATO_UNICO_HEADERS.forEach((header, index) => {
    const column = ws.getColumn(index + 1);
    let width = Math.max(12, Math.min(36, header.length + 2));
    rows.slice(0, 200).forEach(row => { width = Math.max(width, Math.min(36, String(row[header] ?? '').length + 2)); });
    column.width = width;
    if (DATO_UNICO_DATE_HEADERS.has(header)) column.numFmt = 'dd/mm/yyyy';
    if (DATO_UNICO_MONEY_HEADERS.has(header)) column.numFmt = '#,##0.00;[Red](#,##0.00);-';
  });
  ws.views = [{ state: 'frozen', xSplit: 4, ySplit: 3, showGridLines: false }];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
}

function styleMovementsSheet(ws, rows, subtitle) {
  const headers = [
    'Fase', 'Línea', 'Importe aprobado', 'Cuenta avance', 'Tipo', 'Aportante', 'Fecha', 'Nº préstamo',
    'Desembolso banco', 'Aporte promotor', 'Importe pendiente', 'Amortización', 'Interés pagado', 'Pago al banco',
    'Vencimiento', 'Estado', 'Solicitud', 'Confirmado por', 'Referencia', 'Informe avalúo', 'Detalle / unidad', 'Notas'
  ];
  styleTitle(ws, 'Movimientos financieros', subtitle, headers.length);
  ws.addTable({
    name: 'MovimientosTable', ref: 'A5', headerRow: true,
    style: { theme: 'TableStyleMedium4', showRowStripes: true },
    columns: headers.map(name => ({ name })),
    rows: rows.map(item => headers.map(header => item[header] == null ? null : item[header]))
  });
  ws.getRow(5).height = 34;
  ws.getRow(5).font = { name: 'Arial', bold: true, size: 9, color: { argb: COLORS.white } };
  ws.getRow(5).alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const widths = [18, 25, 17, 14, 24, 14, 13, 16, 18, 17, 17, 17, 16, 17, 14, 16, 14, 18, 18, 18, 28, 34];
  widths.forEach((width, index) => { ws.getColumn(index + 1).width = width; });
  [3, 9, 10, 11, 12, 13, 14].forEach(column => { ws.getColumn(column).numFmt = '#,##0.00;[Red](#,##0.00);-'; });
  [7, 15, 17].forEach(column => { ws.getColumn(column).numFmt = 'dd/mm/yyyy'; });
  ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 5, showGridLines: false }];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
}

function datoFormula(title, labelCell, label) {
  const key = normalize(title);
  const q = value => String(value).replace(/"/g, '""');
  if (key === 'estatus lotes / unidades') {
    const criteria = {
      libre: 'DISPONIBLE', inventario: 'INVENTARIO', reserva: 'RESERVADO', 'con cpp': 'CON CPP',
      'tramite legal': 'TRÁMITE LEGAL ACTIVADO', traspasado: 'ESCRITURADO / TRASPASADO',
      'vivienda entregada': 'VIVIENDA ENTREGADA', cancelada: 'CANCELADO'
    }[normalize(label)] || label;
    return `COUNTIFS(DatoUnicoTable[ESTATUS],"${q(criteria)}")`;
  }
  if (key === 'ventas mensuales' && /^\d{4}-\d{2}$/.test(label)) {
    const [year, month] = label.split('-').map(Number);
    return `COUNTIFS(DatoUnicoTable[FECHA DE CONTRATO],">="&DATE(${year},${month},1),DatoUnicoTable[FECHA DE CONTRATO],"<"&EDATE(DATE(${year},${month},1),1))+COUNTIFS(DatoUnicoTable[FECHA DE CONTRATO],"",DatoUnicoTable[FECHA RESERVA],">="&DATE(${year},${month},1),DatoUnicoTable[FECHA RESERVA],"<"&EDATE(DATE(${year},${month},1),1))`;
  }
  if (key === 'ventas por modelo de vivienda') return `COUNTIFS(DatoUnicoTable[MODELO VIVIENDA],${labelCell},DatoUnicoTable[PRECIO DE VENTA],">0")`;
  if (key === 'cpp por banco') return `COUNTIFS(DatoUnicoTable[BANCO DEL CLIENTE],${labelCell},DatoUnicoTable[NUMERO CPP],"<>")`;
  if (key === 'monto de ventas por medio de pago del cliente') return `SUMIFS(DatoUnicoTable[PRECIO DE VENTA],DatoUnicoTable[BANCO DEL CLIENTE],${labelCell})`;
  if (key === 'proformas por banco') return `COUNTIFS(DatoUnicoTable[BANCO DEL CLIENTE],${labelCell},DatoUnicoTable[FECHA PROFORMA],"<>")`;
  if (key === 'hipotecas por banco') return `COUNTIFS(DatoUnicoTable[BANCO DEL CLIENTE],${labelCell},DatoUnicoTable[MINUTA PRÉSTAMO],"<>")`;
  if (key === 'tipo de empresa de compradores') {
    if (normalize(label) === 'sin dato') return 'COUNTIFS(DatoUnicoTable[PRECIO DE VENTA],">0",DatoUnicoTable[TIPO DE EMPRESA],"",DatoUnicoTable[TIPO DE EMPRESA2],"")';
    if (normalize(label).includes('priv')) return 'COUNTIF(DatoUnicoTable[TIPO DE EMPRESA],"*PRIV*")+COUNTIF(DatoUnicoTable[TIPO DE EMPRESA2],"*PRIV*")';
    if (/gub|public|estatal/.test(normalize(label))) return 'COUNTIF(DatoUnicoTable[TIPO DE EMPRESA],"*GUB*")+COUNTIF(DatoUnicoTable[TIPO DE EMPRESA],"*PUBLIC*")+COUNTIF(DatoUnicoTable[TIPO DE EMPRESA],"*ESTATAL*")+COUNTIF(DatoUnicoTable[TIPO DE EMPRESA2],"*GUB*")+COUNTIF(DatoUnicoTable[TIPO DE EMPRESA2],"*PUBLIC*")+COUNTIF(DatoUnicoTable[TIPO DE EMPRESA2],"*ESTATAL*")';
    return `COUNTIF(DatoUnicoTable[TIPO DE EMPRESA],${labelCell})+COUNTIF(DatoUnicoTable[TIPO DE EMPRESA2],${labelCell})`;
  }
  if (key === 'perfil laboral de compradores') {
    if (normalize(label) === 'sin dato') return 'COUNTIFS(DatoUnicoTable[PRECIO DE VENTA],">0",DatoUnicoTable[PERFIL],"",DatoUnicoTable[CLIENTE 2 PERFIL],"")';
    if (/independ|autonom/.test(normalize(label))) return 'COUNTIF(DatoUnicoTable[PERFIL],"*INDEPEND*")+COUNTIF(DatoUnicoTable[PERFIL],"*AUTONOM*")+COUNTIF(DatoUnicoTable[CLIENTE 2 PERFIL],"*INDEPEND*")+COUNTIF(DatoUnicoTable[CLIENTE 2 PERFIL],"*AUTONOM*")';
    if (/asalari|emplead/.test(normalize(label))) return 'COUNTIF(DatoUnicoTable[PERFIL],"*ASALARI*")+COUNTIF(DatoUnicoTable[PERFIL],"*EMPLEAD*")+COUNTIF(DatoUnicoTable[CLIENTE 2 PERFIL],"*ASALARI*")+COUNTIF(DatoUnicoTable[CLIENTE 2 PERFIL],"*EMPLEAD*")';
    return `COUNTIF(DatoUnicoTable[PERFIL],${labelCell})+COUNTIF(DatoUnicoTable[CLIENTE 2 PERFIL],${labelCell})`;
  }
  if (key === 'sexo de compradores') {
    if (normalize(label) === 'sin dato') return 'COUNTIFS(DatoUnicoTable[PRECIO DE VENTA],">0",DatoUnicoTable[SEXO],"",DatoUnicoTable[CLIENTE 2 SEXO],"")';
    if (normalize(label) === 'mujer') return 'COUNTIF(DatoUnicoTable[SEXO],"F")+COUNTIF(DatoUnicoTable[SEXO],"FEMENINO")+COUNTIF(DatoUnicoTable[SEXO],"MUJER")+COUNTIF(DatoUnicoTable[CLIENTE 2 SEXO],"F")+COUNTIF(DatoUnicoTable[CLIENTE 2 SEXO],"FEMENINO")+COUNTIF(DatoUnicoTable[CLIENTE 2 SEXO],"MUJER")';
    if (normalize(label) === 'hombre') return 'COUNTIF(DatoUnicoTable[SEXO],"M")+COUNTIF(DatoUnicoTable[SEXO],"MASCULINO")+COUNTIF(DatoUnicoTable[SEXO],"HOMBRE")+COUNTIF(DatoUnicoTable[CLIENTE 2 SEXO],"M")+COUNTIF(DatoUnicoTable[CLIENTE 2 SEXO],"MASCULINO")+COUNTIF(DatoUnicoTable[CLIENTE 2 SEXO],"HOMBRE")';
    return `COUNTIF(DatoUnicoTable[SEXO],${labelCell})+COUNTIF(DatoUnicoTable[CLIENTE 2 SEXO],${labelCell})`;
  }
  if (key === 'modalidad de compra') {
    return normalize(label).includes('conjunta')
      ? 'COUNTIFS(DatoUnicoTable[PRECIO DE VENTA],">0",DatoUnicoTable[CLIENTE 2 PRIMER NOMBRE],"<>")'
      : 'COUNTIFS(DatoUnicoTable[PRECIO DE VENTA],">0",DatoUnicoTable[CLIENTE 2 PRIMER NOMBRE],"")';
  }
  if (key === 'via de captacion') return `COUNTIFS(DatoUnicoTable[CAPTACIÓN DE CLIENTE],"*"&${labelCell}&"*",DatoUnicoTable[PRECIO DE VENTA],">0")`;
  if (key === 'ingresos mensuales declarados') {
    const incomeColumns = ['DatoUnicoTable[INGRESO MENSUAL]', 'DatoUnicoTable[CLIENTE 2 INGRESO MENSUAL]'];
    const rangeCount = (min, max) => incomeColumns.map(column => `COUNTIFS(${column},">${min}",${column},"<=${max}")`).join('+');
    const labelKey = normalize(label);
    if (labelKey.includes('hasta')) return incomeColumns.map(column => `COUNTIFS(${column},">0",${column},"<=1000")`).join('+');
    if (labelKey.includes('1,001') || labelKey.includes('1001')) return rangeCount(1000, 1500);
    if (labelKey.includes('1,501') || labelKey.includes('1501')) return rangeCount(1500, 2000);
    if (labelKey.includes('2,001') || labelKey.includes('2001')) return rangeCount(2000, 3000);
    if (labelKey.includes('3,001') || labelKey.includes('3001')) return rangeCount(3000, 5000);
    if (labelKey.includes('mas de')) return incomeColumns.map(column => `COUNTIF(${column},">5000")`).join('+');
  }
  const legalHeaders = {
    'minutas de liberacion': 'MINUTA LIBERACIÓN', 'minutas de segregacion': 'MINUTA SEGREGACIÓN',
    'minutas de prestamo': 'MINUTA PRÉSTAMO'
  };
  if (legalHeaders[key]) {
    const condition = ['si', 'sí'].includes(normalize(label)) ? '<>' : '=';
    return `COUNTIFS(DatoUnicoTable[PRECIO DE VENTA],">0",DatoUnicoTable[${legalHeaders[key]}],"${condition}")`;
  }
  if (key === 'estatus construccion' || key === 'fase de construccion') return `COUNTIFS(DatoUnicoTable[ESTATUS CONSTRUCCIÓN],${labelCell})`;
  if (key === 'modelos en construccion') return `COUNTIFS(DatoUnicoTable[MODELO VIVIENDA],${labelCell},DatoUnicoTable[ESTATUS CONSTRUCCIÓN],"<>")`;
  return null;
}

function movementFormula(title, labelCell, seriesName) {
  const key = normalize(title);
  if (key === 'movimientos por tipo') return `SUMIFS(MovimientosTable[Desembolso banco],MovimientosTable[Tipo],${labelCell})+SUMIFS(MovimientosTable[Aporte promotor],MovimientosTable[Tipo],${labelCell})+SUMIFS(MovimientosTable[Amortización],MovimientosTable[Tipo],${labelCell})+SUMIFS(MovimientosTable[Interés pagado],MovimientosTable[Tipo],${labelCell})`;
  if (key === 'flujos bancarios por fase') {
    const column = normalize(seriesName).includes('desembolso') ? 'Desembolso banco'
      : normalize(seriesName).includes('amort') ? 'Amortización' : 'Interés pagado';
    return `SUMIFS(MovimientosTable[${column}],MovimientosTable[Fase],${labelCell})`;
  }
  if (key === 'flujos bancarios por linea') {
    const column = normalize(seriesName).includes('desembolso') ? 'Desembolso banco'
      : normalize(seriesName).includes('amort') ? 'Amortización' : 'Interés pagado';
    return `SUMIFS(MovimientosTable[${column}],MovimientosTable[Línea],${labelCell})`;
  }
  return null;
}

function sectionColor(section) {
  const key = normalize(section);
  if (key.includes('legal')) return COLORS.purpleSoft;
  if (key.includes('tecnico')) return COLORS.amberSoft;
  if (key.includes('financ')) return COLORS.greenSoft;
  return COLORS.blueSoft;
}

function writeChartSheet(ws, groups, subtitle) {
  ws.columns = Array.from({ length: 23 }, (_, index) => ({ width: [8, 12, 12, 12, 12, 12, 12, 8, 18, 16, 4, 4, 8, 12, 12, 12, 12, 12, 12, 8, 18, 16, 4][index] }));
  styleTitle(ws, 'Gráficas del proyecto', subtitle, 23);
  ws.views = [{ state: 'frozen', ySplit: 3, showGridLines: false }];
  const nativeCharts = [];
  let row = 5;
  let activeSection = '';
  let slot = 0;

  groups.forEach(group => {
    if (group.section !== activeSection) {
      if (slot % 2 === 1) row += 18;
      styleSection(ws, row, group.section, 23, sectionColor(group.section));
      activeSection = group.section;
      row += 2;
      slot = 0;
    }
    const isRight = slot % 2 === 1;
    const chartCol = isRight ? 12 : 0;
    const helperCol = isRight ? 21 : 9;
    const helperStart = helperCol + 1;
    const allCategories = group.categories || [];
    const windowStart = /mensual|temporal|evolución/i.test(group.title || '') ? Math.max(0, allCategories.length - 12) : 0;
    const categories = allCategories.slice(windowStart, windowStart + 12);
    const series = (group.series || []).map(item => ({
      ...item,
      values: (item.values || []).slice(windowStart, windowStart + categories.length),
      formulas: (item.formulas || []).slice(windowStart, windowStart + categories.length)
    }));
    const headerRow = row;
    ws.getColumn(helperStart).width = Math.max(ws.getColumn(helperStart).width || 0, 22);
    series.forEach((_, index) => {
      ws.getColumn(helperStart + index + 1).width = Math.max(ws.getColumn(helperStart + index + 1).width || 0, 16);
    });
    ws.getCell(headerRow, helperStart).value = 'Concepto';
    series.forEach((item, index) => { ws.getCell(headerRow, helperStart + index + 1).value = item.name; });
    for (let column = helperStart; column <= helperStart + series.length; column += 1) {
      const cell = ws.getCell(headerRow, column);
      cell.font = { name: 'Arial', bold: true, size: 8, color: { argb: COLORS.white } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.navy } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    }
    categories.forEach((category, index) => {
      const dataRow = headerRow + index + 1;
      ws.getCell(dataRow, helperStart).value = category;
      ws.getCell(dataRow, helperStart).font = { name: 'Arial', size: 8 };
      const labelCell = `${colLetter(helperStart)}${dataRow}`;
      series.forEach((item, seriesIndex) => {
        const cell = ws.getCell(dataRow, helperStart + seriesIndex + 1);
        const formula = item.formulas?.[index] || datoFormula(group.title, labelCell, category) || movementFormula(group.title, labelCell, item.name);
        const result = Number(item.values[index]) || 0;
        cell.value = formula ? { formula, result } : result;
        cell.numFmt = item.numberFormat || '#,##0.00;[Red](#,##0.00);-';
        cell.font = { name: 'Arial', size: 8, color: { argb: formula ? 'FF008000' : 'FF0000FF' } };
      });
    });
    const categoryRange = `$${colLetter(helperStart)}$${headerRow + 1}:$${colLetter(helperStart)}$${headerRow + categories.length}`;
    const chartSeries = series.map((item, index) => ({
      name: item.name,
      valuesRef: `$${colLetter(helperStart + index + 1)}$${headerRow + 1}:$${colLetter(helperStart + index + 1)}$${headerRow + categories.length}`,
      values: item.values,
      color: item.color || PALETTE[index % PALETTE.length]
    }));
    nativeCharts.push({
      title: group.title, type: group.type || 'bar', horizontal: group.horizontal === true,
      numberFormat: group.numberFormat || '#,##0', categoriesRef: categoryRange,
      categories, series: chartSeries,
      from: { col: chartCol, row: row - 1 }, to: { col: chartCol + 8, row: row + 15 }
    });
    slot += 1;
    if (slot % 2 === 0) row += 18;
  });
  if (slot % 2 === 1) row += 18;
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 2, fitToHeight: 0, paperSize: 9 };
  return nativeCharts;
}

function writeSummarySheet(ws, summary, movementRows, subtitle) {
  ws.columns = Array.from({ length: 8 }, () => ({ width: 18 }));
  styleTitle(ws, 'Resumen ejecutivo', subtitle, 8);
  const kpis = [
    ['Unidades', 'ROWS(DatoUnicoTable[UNIDAD])', summary.units?.total || 0],
    ['Ventas formalizadas', 'COUNTIFS(DatoUnicoTable[FECHA DE CONTRATO],"<>")', summary.units?.sold || 0],
    ['Importe de ventas', 'SUM(DatoUnicoTable[PRECIO DE VENTA])', summary.salesAmount || 0],
    ['Monto CPP', 'SUM(DatoUnicoTable[MONTO CPP])', summary.cppAmount || 0],
    ['Desembolso bancario', 'SUM(MovimientosTable[Desembolso banco])', movementRows.reduce((s, r) => s + Number(r['Desembolso banco'] || 0), 0)],
    ['Capital amortizado', 'SUM(MovimientosTable[Amortización])', movementRows.reduce((s, r) => s + Number(r['Amortización'] || 0), 0)],
    ['Intereses pagados', 'SUM(MovimientosTable[Interés pagado])', movementRows.reduce((s, r) => s + Number(r['Interés pagado'] || 0), 0)],
    ['Progreso global', null, Number(summary.progressPct || 0) / 100]
  ];
  kpis.forEach(([label, formula, result], index) => {
    const col = (index % 4) * 2 + 1;
    const row = index < 4 ? 5 : 9;
    ws.mergeCells(row, col, row, col + 1);
    ws.mergeCells(row + 1, col, row + 1, col + 1);
    const labelCell = ws.getCell(row, col);
    const valueCell = ws.getCell(row + 1, col);
    labelCell.value = label;
    valueCell.value = formula ? { formula, result } : result;
    labelCell.font = { name: 'Arial', bold: true, size: 9, color: { argb: COLORS.white } };
    labelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: index >= 4 ? COLORS.green : COLORS.blue } };
    labelCell.alignment = { horizontal: 'center', vertical: 'middle' };
    valueCell.font = { name: 'Arial', bold: true, size: 15, color: { argb: COLORS.navy } };
    valueCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF8FAFC' } };
    valueCell.alignment = { horizontal: 'center', vertical: 'middle' };
    valueCell.numFmt = label === 'Progreso global' ? '0%' : label === 'Unidades' || label === 'Ventas formalizadas' ? '#,##0' : '#,##0.00;[Red](#,##0.00);-';
  });
  styleSection(ws, 13, 'Datos del proyecto', 8);
  const projectRows = [
    ['Proyecto', summary.projectName || 'Proyecto'], ['Tipo de proyecto', summary.projectType || 'No definido'],
    ['Sociedad promotora', summary.promoterCompanyName || 'No definido'], ['Promotor', summary.promoterName || 'No definido'],
    ['Actualizado', summary.updatedAt ? new Date(summary.updatedAt) : new Date()]
  ];
  projectRows.forEach((item, index) => {
    const row = 14 + index;
    ws.getCell(row, 1).value = item[0]; ws.getCell(row, 1).font = { name: 'Arial', bold: true, color: { argb: COLORS.slate } };
    ws.mergeCells(row, 2, row, 4); ws.getCell(row, 2).value = item[1]; ws.getCell(row, 2).font = { name: 'Arial', color: { argb: COLORS.navy } };
  });
  ws.getCell(18, 2).numFmt = 'dd/mm/yyyy hh:mm';
  ws.getCell('A21').value = 'Las hojas Dato único y Movimientos son editables. Las fórmulas y gráficas se actualizan al abrir el archivo en Excel.';
  ws.mergeCells('A21:H21');
  ws.getCell('A21').font = { name: 'Arial', italic: true, size: 9, color: { argb: COLORS.slate } };
  ws.views = [{ showGridLines: false }];
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 1, paperSize: 9 };
}

async function buildExecutiveSummaryWorkbook({ summary, datoRows, movementRows, chartGroups }) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Bank73';
  wb.created = new Date();
  wb.calcProperties.fullCalcOnLoad = true;
  wb.calcProperties.forceFullCalc = true;
  wb.calcProperties.calcMode = 'auto';
  const updated = summary.updatedAt ? new Date(summary.updatedAt).toLocaleString('es-ES') : new Date().toLocaleString('es-ES');
  const subtitle = `${summary.projectName || 'Proyecto'} · Actualizado ${updated}`;

  const wsSummary = wb.addWorksheet('Resumen', { properties: { tabColor: { argb: COLORS.navy } } });
  const wsDato = wb.addWorksheet('Dato único', { properties: { tabColor: { argb: COLORS.blue } } });
  const wsMov = wb.addWorksheet('Movimientos', { properties: { tabColor: { argb: COLORS.amber } } });
  const wsCharts = wb.addWorksheet('Gráficas', { properties: { tabColor: { argb: COLORS.green } } });
  styleDatoUnicoSheet(wsDato, datoRows);
  styleMovementsSheet(wsMov, movementRows, subtitle);
  const nativeCharts = writeChartSheet(wsCharts, chartGroups, subtitle);
  writeSummarySheet(wsSummary, summary, movementRows, subtitle);

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());
  return addNativeCharts(buffer, { sheetNumber: 4, sheetName: 'Gráficas', charts: nativeCharts });
}

module.exports = { buildExecutiveSummaryWorkbook, numberValue };
