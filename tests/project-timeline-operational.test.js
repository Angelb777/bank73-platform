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

test('una CPP histórica deja de alertar cuando la obligación ya está resuelta', () => {
  const js = read('public/js/project.js');

  assert.match(js, /function isCppObligationOpen\(unit = \{\}, sale = \{\}\)/);
  assert.match(js, /sale\.fechaDesembolso/);
  assert.match(js, /sale\.fechaRecibidoCheque/);
  assert.match(js, /sale\.fechaEntregaVivienda/);
  assert.match(js, /sale\.estadoVenta/);
  assert.match(js, /if \(isCppObligationOpen\(unit, sale\)\)/);
  assert.match(js, /if \(!isCppObligationOpen\(u, venta\)\) return null/);
});

test('los avisos operativos cesan cuando su obligación real ya terminó', () => {
  const js = read('public/js/project.js');

  assert.match(js, /function isUnitConstructionComplete\(unit = \{\}, sale = \{\}\)/);
  assert.match(js, /progress >= 100/);
  assert.match(js, /sale\.permisoOcupacion/);
  assert.match(js, /if \(!isUnitConstructionComplete\(unit, sale\)\)/);
  assert.match(js, /type === 'CAR' && constructionScopeComplete/);
  assert.match(js, /amortized >= disbursed/);
  assert.match(js, /requirement\?\.isArchived === true/);
});

test('el semáforo se sincroniza inmediatamente después de guardar datos del proyecto', () => {
  const js = read('public/js/project.js');

  assert.match(js, /window\.syncProjectTimelineFromCanonicalData\?\.\(\)/);
  assert.match(js, /await window\.refreshProjectTimelineData\?\.\(\)/);
  assert.match(js, /window\.syncProjectTimelineFromCanonicalData = \(\) =>/);
  assert.match(js, /getProjectFinanceSnapshot\(\{ force:true \}\)/);
  assert.match(js, /getProjectExpiryAlertResolutions\(\{ force:true \}\)/);
  assert.match(js, /getProjectDocuments\(\{ force:true \}\)/);
  assert.match(js, /getProjectPermits\(\{ force:true \}\)/);
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

test('los puntos rojos de fase se reservan a checklists vencidos', () => {
  const project = read('public/js/project.js');
  const unified = read('public/js/project-unified.js');

  assert.match(project, /alerts: operationalAlerts\.length/);
  assert.match(project, /delayed: delayedTasks \+ criticalAlerts/);
  assert.match(unified, /phase\.checklistDelayed \? 'has-alert' : ''/);
  assert.doesNotMatch(unified, /phase\.alerts \|\| phase\.delayed \? 'has-alert'/);
  assert.match(unified, /Avisos activos/);
});

test('contratistas y obra comparten paquetes con rango y contratista únicos', () => {
  const js = read('public/js/project.js');
  const routes = read('routes/process.js');
  const model = read('models/ProjectWorkPackage.js');

  assert.match(js, /function renderWorkPackagePhase\(phaseKey, checklists\)/);
  assert.match(js, /function openWorkPackageEditor\(packageId = ''\)/);
  assert.match(js, /\+ Nuevo paquete/);
  assert.match(js, /Contratista:/);
  assert.doesNotMatch(js, /unitScopedChecklistPanelHtml/);
  assert.match(routes, /projects\/:projectId\/work-packages/);
  assert.match(routes, /work-packages\/:id\/checklist-progress/);
  assert.match(model, /checklistId/);
  assert.match(model, /unitIds/);
  assert.match(model, /contractorName/);
  assert.match(model, /checklistStates/);
});

test('escrituracion reutiliza el proceso comercial canonico de la unidad', () => {
  const js = read('public/js/project.js');

  assert.match(js, /function timelineCommercialProcess\(sale = \{\}, unit = \{\}\)/);
  assert.match(js, /Proceso desde reserva hasta entrega/);
  assert.match(js, /Abrir proceso/);
  assert.match(js, /openUnit\?\.\(button\.dataset\.unitId, \{ mode:'commercial' \}\)/);
  assert.doesNotMatch(read('models/UnitChecklistProgress.js'), /ESCRITURACION|fechaReserva|fechaInscripcion/);
});

test('escrituracion respeta como avance minimo el estado real importado de la unidad', () => {
  const js = read('public/js/project.js');
  const route = read('routes/projects.js');

  assert.match(js, /function timelineCommercialProcess\(sale = \{\}, unit = \{\}\)/);
  assert.match(js, /reservado: 1[\s\S]*?con_cpp: 2[\s\S]*?tramite_legal_activado: 3[\s\S]*?escriturado_traspasado: 5/);
  assert.match(js, /const minimumComplete = deliveryEvidence \? 6/);
  assert.match(js, /stage\.inferred = true/);
  assert.match(js, /label:complete === 6 \? 'Proceso completado'/);
  assert.match(js, /según estado de la unidad/);
  assert.match(js, /timelineCommercialProcess\(snapshot\.sales\.get\(String\(unit\._id\)\) \|\| \{\}, unit\)/);
  assert.match(route, /if \(t\.includes\('ESCRITURAD'\)\) return 'escriturado_traspasado'/);
  assert.match(route, /if \(t\.includes\('TRASPAS'\)\) return 'escriturado_traspasado'/);
  assert.match(route, /if \(t\.includes\('ENTREG'\)\) return 'vivienda_entregada'/);
});

test('el semaforo muestra nombres de tareas y paquetes responsables', () => {
  const js = read('public/js/project.js');
  const css = read('public/css/project-unified.css');

  assert.match(js, /class="role-task-popover"/);
  assert.match(js, /role="tooltip"/);
  assert.match(js, /task\.title.*workPackage\.name/s);
  assert.match(css, /\.role-task-popover/);
  assert.match(css, /role-row:hover \.role-task-popover/);
  assert.match(css, /\.role-row::after\{[^}]*height:8px[^}]*background:transparent/);
  assert.match(css, /\.role-task-popover\{[^}]*overscroll-behavior:contain[^}]*scrollbar-gutter:stable/);
  assert.match(js, /event\.target\.closest\('\.role-task-popover'\)/);
});
