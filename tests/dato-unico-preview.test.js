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
    /Excel vacío o formato inesperado/
  );
});
