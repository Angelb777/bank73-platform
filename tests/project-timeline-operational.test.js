const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('el cronograma integra alertas operativas en fases y semaforo por rol', () => {
  const js = read('public/js/project.js');

  assert.match(js, /function buildOperationalTimelineAlerts\(\)/);
  assert.match(js, /kind: 'cpp', phase: 'FINANCIACION'/);
  assert.match(js, /kind: 'promissory_note', phase: 'FINANCIACION'/);
  assert.match(js, /kind: 'permit_document', phase: 'PERMISOS'/);
  assert.match(js, /kind: 'insurance_policy'/);
  assert.match(js, /kind: 'credit_line', phase: 'FINANCIACION'/);
  assert.match(js, /function roleOperationalSignal\(roleKey\)/);
  assert.match(js, /signal\.critical\.length \+ cntOverdue/);
});

test('las fases base conservan sus checklists sin insertar un resumen operativo duplicado', () => {
  const js = read('public/js/project.js');
  const css = read('public/css/project-unified.css');

  assert.match(js, /function renderOperationalPhaseSummary\(phaseKey\)/);
  assert.match(js, /data-phase-alerts=/);
  assert.match(js, /function openOperationalAlerts\(phaseKey\)/);
  assert.doesNotMatch(js, /renderOperationalPhaseSummary\(ph\.key\)/);
  assert.match(js, /\['CONTRATISTAS', 'OBRA'\]\.includes\(ph\.key\)/);
  assert.match(css, /\.timeline-operational-summary/);
  assert.match(css, /\.timeline-alert-button\.is-danger/);
});

test('escrituracion, contratistas y obra se calculan desde unidades y ventas', () => {
  const js = read('public/js/project.js');

  assert.match(js, /function operationalUnitsSnapshot\(\)/);
  assert.match(js, /title = 'Contratistas y paquetes'/);
  assert.match(js, /title = 'Obra por unidad'/);
  assert.match(js, /title = 'Proceso por unidad'/);
  assert.match(js, /fechaEntregaVivienda/);
  assert.match(js, /counts\.reserved/);
  assert.match(js, /counts\.deeded/);
  assert.match(js, /counts\.delivered/);
});

test('la barra superior del cronograma expone avisos operativos por fase', () => {
  const project = read('public/js/project.js');
  const unified = read('public/js/project-unified.js');

  assert.match(project, /alerts: operationalAlerts\.length/);
  assert.match(project, /delayed: delayedTasks \+ criticalAlerts/);
  assert.match(unified, /phase\.alerts \|\| phase\.delayed/);
  assert.match(unified, /Avisos activos/);
});

test('contratistas y obra aplican sus actividades por unidad o rango', () => {
  const js = read('public/js/project.js');
  const routes = read('routes/process.js');
  const model = read('models/UnitChecklistProgress.js');

  assert.match(js, /function renderUnitScopedPhase\(phaseKey, checklists\)/);
  assert.match(js, /function openUnitChecklistRange\(checklistId\)/);
  assert.match(js, /Gestionar unidades \/ rango/);
  assert.match(js, /unitScopedChecklistPanelHtml\(unitId\)/);
  assert.match(routes, /unit-checklist-progress/);
  assert.match(routes, /unit-progress/);
  assert.match(model, /checklistId/);
  assert.match(model, /unitId/);
  assert.match(model, /unique: true/);
});

test('escrituracion reutiliza el proceso comercial canonico de la unidad', () => {
  const js = read('public/js/project.js');

  assert.match(js, /function timelineCommercialProcess\(sale = \{\}\)/);
  assert.match(js, /Proceso desde reserva hasta entrega/);
  assert.match(js, /Abrir proceso/);
  assert.match(js, /openUnit\?\.\(button\.dataset\.unitId, \{ mode:'commercial' \}\)/);
  assert.doesNotMatch(read('models/UnitChecklistProgress.js'), /ESCRITURACION|fechaReserva|fechaInscripcion/);
});

test('el semaforo muestra nombres de tareas y unidades responsables', () => {
  const js = read('public/js/project.js');
  const css = read('public/css/project-unified.css');

  assert.match(js, /class="role-task-popover"/);
  assert.match(js, /role="tooltip"/);
  assert.match(js, /task\.title.*unitDisplayName/s);
  assert.match(css, /\.role-task-popover/);
  assert.match(css, /role-row:hover \.role-task-popover/);
});
