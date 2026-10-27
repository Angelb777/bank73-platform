const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { summarizeDatoUnico } = require('../services/datoUnicoPreview');

function workbookBuffer(dataRows) {
  const rows = [
    ['EXPEDIENTES DE BANCO'],
    ['MANZANA', 'LOTE', 'MODELO', 'RECAMARAS', 'BAÑOS', 'AREA ABIERTA', 'AREA CERRADA', 'PRECIO DE VENTA', 'ESTATUS LOTE'],
    ...dataRows
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'EXPEDIENTES-BANCO');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
}

test('Dato Único agrupa modelos y sugiere características consistentes', () => {
  const preview = summarizeDatoUnico(workbookBuffer([
    ['M1', '1', 'Modelo A', 3, 2, 15, 90, 150000, 'DISPONIBLE'],
    ['M1', '2', 'modelo a', 3, 2, 15, 90, 150000, 'RESERVA'],
    ['M2', '1', 'Modelo B', 2, 1, 10, 70, 110000, 'INVENTARIO']
  ]));

  assert.equal(preview.valid, true);
  assert.equal(preview.unitsTotal, 3);
  assert.equal(preview.units.length, 3);
  assert.equal(preview.units[0].reference, 'M1-1');
  assert.equal(preview.models.length, 2);
  assert.deepEqual(preview.models[0].conflicts, []);
  assert.equal(preview.models[0].name, 'Modelo A');
  assert.equal(preview.models[0].unitsCount, 2);
  assert.equal(preview.models[0].bedrooms, 3);
  assert.equal(preview.models[0].bathrooms, 2);
  assert.equal(preview.models[0].initialStatuses.disponible, 1);
  assert.equal(preview.models[0].initialStatuses.reservado, 1);
});

test('Dato Único avisa de valores variables y unidades duplicadas', () => {
  const preview = summarizeDatoUnico(workbookBuffer([
    ['M1', '1', 'Modelo A', 2, 1, 10, 70, 100000, 'DISPONIBLE'],
    ['M1', '1', 'Modelo A', 3, 2, 15, 80, 120000, 'DISPONIBLE']
  ]));

  assert.equal(preview.valid, false);
  assert.equal(preview.duplicates.length, 1);
  assert.match(preview.error, /filas 3 y 4/);
  assert.ok(preview.models[0].conflicts.includes('bedrooms'));
  assert.ok(preview.models[0].conflicts.includes('price'));
  assert.equal(preview.models[0].bedrooms, null);
});

test('Dato Único cuenta unidades sin modelo sin inventar una tipología', () => {
  const preview = summarizeDatoUnico(workbookBuffer([
    ['M1', '1', '', 3, 2, 15, 90, 150000, 'DISPONIBLE']
  ]));

  assert.equal(preview.valid, true);
  assert.equal(preview.unnamedUnits, 1);
  assert.equal(preview.models.length, 0);
});

test('Dato Único rechaza un Excel sin unidades válidas', () => {
  assert.throws(
    () => summarizeDatoUnico(workbookBuffer([])),
    /No se encontraron unidades válidas/
  );
});

test('Dato Único reconoce BASE DATOS con unidades de apartamentos', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Lista de precios'],
    ['Ud.', 'Nivel', 'Modelo', 'Apartamento', 'Precio'],
    [1, 100, 'A', 101, 'B/.220,862.25']
  ]), 'LISTA PRECIOS');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['UNIDAD APTO', 'NIVEL', 'CLIENTE', 'RESERVADAS, VENDIDAS', 'MODELO', 'AREA CERRADA', 'AREA BALCON', 'VALOR TOTAL'],
    ['L-501', '000', 'Cliente Uno', 'TRASPASADO', 'A', 65.93, 0, 'B/.168,121.50'],
    ['L-502', '000', '', 'DISPONIBLE', 'B', 59.94, 0, 'B/.182,000.00'],
    ['L-503', '000', '', '', 'C1', 73.09, 2, 'B/.205,107.09']
  ]), 'BASE DATOS');

  const preview = summarizeDatoUnico(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));

  assert.equal(preview.valid, true);
  assert.equal(preview.sheet, 'BASE DATOS');
  assert.equal(preview.unitsTotal, 3);
  assert.equal(preview.models.length, 3);
  assert.equal(preview.models[0].price, 168121.5);
  assert.equal(preview.models[0].initialStatuses.escriturado_traspasado, 1);
  assert.equal(preview.models[1].initialStatuses.disponible, 1);
  assert.equal(preview.models[2].initialStatuses.inventario, 1);
});

test('Dato Único reconoce el modelo definitivo con ETAPA, TORRE, NIVEL y UNIDAD', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['DATO ÚNICO'],
    ['DATOS BÁSICOS'],
    ['ETAPA', 'TORRE', 'NIVEL', 'UNIDAD', 'CLIENTE', 'ESTATUS', 'PRECIO DE VENTA', 'MONTO CPP', 'PORCENTAJE DE FINANCIAMIENTO2', 'BANCO DEL CLIENTE', 'AREA TERRENO M2', 'MODELO VIVIENDA', 'AREA ABIERTA VIVIENDA', 'AREA CERRADA VIVIENDA', 'RECÁMARAS', 'BAÑOS'],
    ['Etapa 1', 'Torre A', '03', 'A-301', 'Cliente Uno', 'CON CPP', 180000, 144000, 80, 'Banco General', 92, 'Modelo A', 8, 84, 3, 2]
  ]), 'EXPEDIENTES-BANCO');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['LOTE', 'CLIENTE'],
    [0, 0]
  ]), 'ABONOS');

  const preview = summarizeDatoUnico(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));

  assert.equal(preview.valid, true);
  assert.equal(preview.sheet, 'EXPEDIENTES-BANCO');
  assert.equal(preview.unitsTotal, 1);
  assert.deepEqual(preview.units[0], {
    etapa: 'Etapa 1',
    torre: 'Torre A',
    nivel: '03',
    manzana: 'Etapa 1 · Torre A · 03',
    lote: 'A-301',
    modelo: 'Modelo A',
    reference: 'Etapa 1 · Torre A · 03-A-301'
  });
  assert.equal(preview.models[0].name, 'Modelo A');
  assert.equal(preview.models[0].price, 180000);
  assert.equal(preview.models[0].initialStatuses.con_cpp, 1);
});

test('Dato Único no cae en ABONOS cuando la plantilla definitiva todavía está vacía', () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['DATO ÚNICO'],
    ['DATOS BÁSICOS'],
    ['ETAPA', 'TORRE', 'NIVEL', 'UNIDAD', 'CLIENTE', 'ESTATUS']
  ]), 'EXPEDIENTES-BANCO');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['LOTE', 'CLIENTE'],
    [0, 0]
  ]), 'ABONOS');

  assert.throws(
    () => summarizeDatoUnico(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })),
    /No se encontraron unidades válidas/
  );
});
