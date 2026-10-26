'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('la ficha comercial sigue el proceso de venta propuesto y mantiene sus campos editables', () => {
  const js = read('public/js/project.js');
  const css = read('public/css/theme.css');

  assert.match(js, /function renderCommercialProcessFicha/);
  for (const title of ['Reserva', 'Carta promesa de pago y contrato', 'Avalúo', 'Protocolo \/ Escrituras', 'Cierre notarial \/ Registro Público', 'Desembolso y entrega']) {
    assert.match(js, new RegExp(title));
  }
  assert.match(js, /unit-process-left/);
  assert.match(js, /unit-process-main/);
  assert.match(js, /unit-process-right/);
  assert.match(css, /\.unit-process-layout/);
  assert.match(css, /grid-template-columns:minmax\(250px,300px\)/);
  assert.match(js, /v\.clienteNombre \|\| \[v\.primerNombre/);
  assert.match(js, /'fv-clienteNombre','Nombre completo'/);
  for (const fieldId of ['fv-primerNombre','fv-segundoNombre','fv-primerApellido','fv-segundoApellido','fv-cliente2PrimerNombre','fv-cliente2SegundoNombre','fv-cliente2PrimerApellido','fv-cliente2SegundoApellido']) {
    assert.match(js, new RegExp(fieldId));
  }
  assert.match(js, /Nombre completo'[^\n]+readonly aria-readonly="true"/);
  assert.doesNotMatch(js, /vBody\.primerNombre = ''/);
  assert.match(js, /const captureChannel = v\.captadoAtencionOficina/);
  assert.doesNotMatch(read('models/Venta.js'), /canalCaptacion|fechaSolicitudAvaluo/);
  assert.match(css, /unit-status-reservado[^\n]+#f59e0b/);
  assert.match(css, /unit-process-summary \{ grid-template-columns:repeat\(4/);
  assert.match(js, /\{ v: 'disponible', l: 'Lote libre' \}/);
  assert.match(js, /\{ v: 'escriturado_traspasado', l: 'Traspasado' \}/);
  const stateCatalog = js.slice(js.indexOf('const UNIT_ESTADOS = ['), js.indexOf('function estadoLabel'));
  assert.equal((stateCatalog.match(/\{ v:/g) || []).length, 6);
  assert.doesNotMatch(stateCatalog, /vivienda_entregada|Vivienda entregada/);
  assert.doesNotMatch(read('public/project.html'), /<option value="vivienda_entregada">/);
  assert.match(css, /unit-title-status select option \{ background:#182238; color:#f8fafc;/);
  assert.match(css, /unit-process-field select option/);
  assert.match(css, /color-scheme:dark/);
  assert.match(js, /class="unit-title-project-name"/);
  assert.match(css, /\.unit-title-project-name \{ position:absolute; left:50%/);
  assert.match(js, /id="fu-modeloSelect"/);
  assert.match(js, /applyProjectModelToFicha/);
  assert.match(js, /applyProjectModelToFicha\(fichaModelSelect\.value, \{ onlyMissing:true \}\)/);
  const modelDefaults = js.slice(js.indexOf('function modelToUnitDefaults'), js.indexOf('// Carga ventas del proyecto'));
  assert.match(modelDefaults, /parseDecimalMeasureNumber/);
  assert.doesNotMatch(modelDefaults, /setValue\('fu-m2'/);
  assert.match(js, /function refreshCommercialSummaryKpis/);
  assert.match(js, /function refreshOpenFichaCommercialStatePreview/);
  assert.match(js, /normalizeCpp:event\.target\.id === 'fv-fechaValorCPP'/);
  assert.match(js, /function reservationAgeInfo/);
  assert.match(js, /Reserva sin fecha registrada/);
  assert.match(js, /class="alert-ribbon reservation-alert"/);
  assert.match(js, /laterStageStarted/);
  assert.match(js, /function refreshCommercialProcessProgress/);
  assert.match(js, /class="unit-status-info-button"/);
  assert.match(css, /top:calc\(100% \+ 10px\)/);
  for (const definition of ['Lote libre:', 'Inventario:', 'Reservado:', 'Con CPP:', 'Trámite legal:', 'Traspasado:']) {
    assert.match(js, new RegExp(definition));
  }
  assert.match(read('public/project.html'), /id="fichaSaveStatus"[^>]*>Autoguardado activo/);
  assert.match(read('public/project.html'), /id="fichaGuardar"[^>]*>Guardar cambios/);
  assert.match(css, /\.unit-save-primary \{/);
  assert.match(js, /function scheduleFichaAutosave/);
  assert.match(js, /guardarFicha\(\{ close: false, silent: true \}\)/);
  assert.match(js, /Guardando antes de cerrar/);
  for (const fieldId of ['fu-etapa', 'fu-torre', 'fu-nivel', 'fv-fechaDesembolso']) {
    assert.match(js, new RegExp(fieldId));
  }

  const openModalStart = js.indexOf('async function abrirFichaUnidad');
  const openModalEnd = js.indexOf('window.abrirFichaUnidad = abrirFichaUnidad', openModalStart);
  const openModalSource = js.slice(openModalStart, openModalEnd);
  assert.ok(openModalStart >= 0 && openModalEnd > openModalStart);
  assert.doesNotMatch(openModalSource, /getDisplayClienteName\(/);
  assert.match(openModalSource, /String\(v\.clienteNombre \|\| ''\)\.trim\(\)/);
});

test('el importador cubre los encabezados del Dato Único definitivo y sincroniza la unidad', () => {
  const route = read('routes/projects.js');
  const unit = read('models/Unit.js');

  for (const header of [
    'MODELO VIVIENDA',
    'BANCO DEL CLIENTE',
    'PORCENTAJE DE FINANCIAMIENTO2',
    'AREA TERRENO M2',
    'CLIENTE 2 PERFIL',
    'TIPO DE EMPRESA2',
    'CAPTACIÓN DE CLIENTE',
    'FECHA VENCIMIENTO PERMISO CONSTRUCCIÓN',
    'PROTOCOLO FIRMA PROMOTOR',
    'FIRMA PROTOCOLO BANCO INTERINO',
    'FECHA DE ESCRITURA',
    'COMENTARIOS'
  ]) {
    assert.match(route, new RegExp(header));
  }
  assert.match(route, /\.\.\.importedUnitFields/);
  assert.match(unit, /etapa:\s+\{ type: String/);
  assert.match(unit, /torre:\s+\{ type: String/);
  assert.match(unit, /nivel:\s+\{ type: String/);
});

test('precioVenta es el único precio persistido por unidad comercial', () => {
  const unit = read('models/Unit.js');
  const venta = read('models/Venta.js');
  const project = read('public/js/project.js');

  assert.doesNotMatch(unit, /precioLista/);
  assert.match(venta, /precioVenta/);
  assert.match(project, /ventasMap\.get\(String\(u\._id\)\)\?\.precioVenta/);
  assert.match(project, /formatProjectMoney\(venta\?\.precioVenta \|\| 0\)/);
});
