'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');

const {
  DATO_UNICO_HEADERS,
  buildDatoUnicoExportRow
} = require('../services/datoUnicoExport');
const { summarizeDatoUnico } = require('../services/datoUnicoPreview');
const exportRouter = require('../routes/export');

test('exportación Dato Único conserva las 97 columnas definitivas en orden', () => {
  assert.equal(DATO_UNICO_HEADERS.length, 97);
  assert.deepEqual(DATO_UNICO_HEADERS.slice(0, 10), [
    'ETAPA', 'TORRE', 'NIVEL', 'UNIDAD', 'CLIENTE', 'ESTATUS',
    'PRECIO DE VENTA', 'MONTO CPP', 'PORCENTAJE DE FINANCIAMIENTO2',
    'BANCO DEL CLIENTE'
  ]);
  assert.deepEqual(DATO_UNICO_HEADERS.slice(-4), [
    'FECHA DE INSCRIPCION', 'FECHA DESEMBOLSO',
    'FECHA DE ENTREGA DE VIVIENDA', 'COMENTARIOS'
  ]);
  assert.equal(DATO_UNICO_HEADERS[76], ' RESOLUCION PERMISO CONSTRUCCION ');
});

test('exportación Dato Único combina correctamente unidad, cliente y expediente comercial', () => {
  const unit = {
    etapa: 'Etapa 2', torre: 'Torre B', nivel: '7', lote: 'B-704',
    estado: 'con_cpp', modelo: 'Modelo Mar', m2: 130,
    numeroFinca: 'F-12', codigoUbicacion: 'CU-9', calle: 'Calle 4',
    areaAbierta: 20, areaCerrada: 80, areaTotalConstruccion: 105,
    recamaras: 3, banos: 2, valorMejoras: 70000, valorTerreno: 50000,
    clienteId: { nombre: 'Ana Pérez', cedula: '8-100-200', email: 'ana@example.com' }
  };
  const venta = {
    precioVenta: 200000, montoFinanciamientoCPP: 160000,
    banco: 'Banco Uno', primerNombre: 'Ana', primerApellido: 'Pérez',
    celular: '6000-0000', ingresoMensual: 3500,
    captadoMailInternet: true, fechaReserva: '2026-10-10T00:00:00.000Z',
    numCPP: 'CPP-77', aperturaCtaBanco: true, polizas: true,
    permisoConstruccionNum: 'PC-12', permisoOcupacionNum: 'PO-6',
    fechaDesembolso: '2026-12-15T00:00:00.000Z', comentario: 'Expediente completo'
  };

  const row = buildDatoUnicoExportRow(unit, venta);

  assert.deepEqual(Object.keys(row), DATO_UNICO_HEADERS);
  assert.equal(row.ETAPA, 'Etapa 2');
  assert.equal(row.UNIDAD, 'B-704');
  assert.equal(row.CLIENTE, 'Ana Pérez');
  assert.equal(row.ESTATUS, 'CON CPP');
  assert.equal(row['PORCENTAJE DE FINANCIAMIENTO2'], 80);
  assert.equal(row['AREA TOTAL CONSTRUCCIÓN'], 105);
  assert.equal(row.CEDULA, '8-100-200');
  assert.equal(row.EMAIL, 'ana@example.com');
  assert.equal(row['CAPTACIÓN DE CLIENTE'], 'Mail / Internet');
  assert.equal(row['APERTURA CUENTA BANCO'], 'SI');
  assert.equal(row[' RESOLUCION PERMISO CONSTRUCCION '], 'PC-12');
  assert.equal(row['FECHA DESEMBOLSO'].toISOString(), '2026-12-15T00:00:00.000Z');

  const withoutSale = buildDatoUnicoExportRow({ costoUnidad: 99999 }, {});
  assert.equal(withoutSale['PRECIO DE VENTA'], null);
});

test('XLSX comercial usa la hoja y fila de cabeceras del modelo definitivo', async () => {
  const row = buildDatoUnicoExportRow(
    { etapa: 'E1', torre: 'T1', nivel: '1', lote: '101', estado: 'disponible' },
    { fechaReserva: '2026-10-01T00:00:00.000Z' }
  );
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('EXPEDIENTES-BANCO');
  exportRouter._test.styleDatoUnicoWorksheet(worksheet, [row]);
  const buffer = await workbook.xlsx.writeBuffer();

  const reopened = new ExcelJS.Workbook();
  await reopened.xlsx.load(buffer);
  const exportedSheet = reopened.getWorksheet('EXPEDIENTES-BANCO');
  const headers = exportedSheet.getRow(3).values.slice(1);

  assert.deepEqual(headers, DATO_UNICO_HEADERS);
  assert.equal(exportedSheet.getCell('A4').value, 'E1');
  assert.equal(exportedSheet.getCell('D4').value, '101');
  assert.ok(exportedSheet.getCell('BH4').value instanceof Date);
  assert.equal(exportedSheet.autoFilter, 'A3:CS3');

  const reimportPreview = summarizeDatoUnico(Buffer.from(buffer));
  assert.equal(reimportPreview.sheet, 'EXPEDIENTES-BANCO');
  assert.equal(reimportPreview.unitsTotal, 1);
  assert.equal(reimportPreview.valid, true);
});

test('CSV comercial conserva las cabeceras aunque el proyecto no tenga unidades', () => {
  const csv = exportRouter._test.toCSV([]);
  assert.equal(csv.split('\n').length, 1);
  assert.deepEqual(csv.split(';'), DATO_UNICO_HEADERS);
});
