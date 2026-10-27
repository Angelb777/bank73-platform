const test = require('node:test');
const assert = require('node:assert/strict');

const unitsRouter = require('../routes/units');
const search = unitsRouter.__searchHelpers;

test('el buscador comercial incluye banco, CPP y datos de ambos clientes', () => {
  for (const field of [
    'banco', 'oficialBanco', 'statusBanco', 'estatusCPP', 'numCPP',
    'clienteNombre', 'primerNombre', 'primerApellido', 'correo',
    'cliente2PrimerNombre', 'cliente2PrimerApellido', 'cliente2Correo'
  ]) {
    assert.ok(search.saleFields.includes(field), `falta el campo comercial ${field}`);
  }
});

test('el buscador comercial incluye la identidad y ubicación completa de la unidad', () => {
  for (const field of [
    'code', 'etapa', 'torre', 'nivel', 'modelo', 'manzana', 'lote',
    'numeroFinca', 'codigoUbicacion', 'calle', 'ubicacion', 'estado'
  ]) {
    assert.ok(search.unitFields.includes(field), `falta el campo de unidad ${field}`);
  }
});

test('acepta prefijos de búsqueda y limita entradas excesivas', () => {
  assert.equal(search.normalizedCommercialSearch('  banco: BAC  '), 'BAC');
  assert.equal(search.normalizedCommercialSearch('CPP: PROMESA-77'), 'PROMESA-77');
  assert.equal(search.normalizedCommercialSearch('x'.repeat(200)).length, 120);
  assert.deepEqual(search.commercialSearchTerms('Pedro Contreras'), ['Pedro', 'Contreras']);
  assert.deepEqual(search.commercialSearchTerms('banco: Caja de Ahorros'), ['Caja', 'de', 'Ahorros']);
});
