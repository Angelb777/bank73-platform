const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'portfolio.html'), 'utf8');
const script = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'portfolio.js'), 'utf8');

test('los permisos de alta se muestran en Datos técnicos antes de los planos', () => {
  const technicalStart = html.indexOf('data-create-panel="technical"');
  const permits = html.indexOf('id="createPermitTemplate"');
  const plans = html.indexOf('id="createArchitecturalPlans"');
  const technicalEnd = html.indexOf('data-create-panel="financial"');

  assert.ok(technicalStart >= 0);
  assert.ok(permits > technicalStart);
  assert.ok(plans > permits);
  assert.ok(technicalEnd > plans);
  assert.equal(html.match(/id="createPermitTemplate"/g)?.length, 1);
});

test('la creación explica que los datos financieros son el plan estimado', () => {
  assert.match(html, /Planifica la estimación/);
  assert.match(html, /registra también su realidad/);
  assert.match(html, /Dato Único seguirá siendo la única fuente/);
});

test('las pólizas pueden seleccionar referencias procedentes de Dato Único', () => {
  assert.match(script, /createDatoUnicoPreviewState\?\.units/);
  assert.match(script, /unit\.reference \|\| unit\.code/);
  assert.match(script, /renderCreateDatoUnicoPreview\(preview\);\s*refreshCreatePolicyUnitOptions\(\);/);
});

test('las pólizas mantienen también el selector de unidades creadas manualmente', () => {
  assert.match(script, /: collectInitialUnits\(\)/);
  assert.match(script, /refreshCreatePolicyUnitOptions\(\);/);
});

test('Datos técnicos permite descargar la plantilla general antes de crear el proyecto', () => {
  assert.match(html, /id="downloadCreateDatoUnicoTemplate"/);
  assert.match(script, /\/api\/projects\/commercial-template\/info/);
  assert.match(script, /\/api\/projects\/commercial-template\/download/);
});

test('cada fase del alta recoge las fechas previstas que usa el resumen financiero', () => {
  assert.match(script, /Inicio previsto<\/span><input class="input" data-create-phase="startDate" type="date"/);
  assert.match(script, /Fin previsto<\/span><input class="input" data-create-phase="endDate" type="date"/);
  assert.match(script, /startDate: row\.querySelector\('\[data-create-phase="startDate"\]'\)/);
  assert.match(script, /endDate: row\.querySelector\('\[data-create-phase="endDate"\]'\)/);
  assert.doesNotMatch(script, /Fecha de carta<input data-create-phase-condition="letterDate"/);
  assert.doesNotMatch(script, /Numero o referencia de carta<input data-create-phase-condition="letterReference"/);
});

test('el alta financiera comparte el flujo Estimación y Realidad de Finanzas', () => {
  assert.match(script, /data-create-phase-view="plan"/);
  assert.match(script, /data-create-phase-view="real"/);
  assert.match(script, /data-copy-create-plan-to-real/);
  assert.match(script, /data-copy-create-real-to-plan/);
  assert.match(script, /data-create-phase="actualStartDate"/);
  assert.match(script, /data-create-phase="actualEndDate"/);
  assert.match(script, /fundingSources: Array\.from\(useRow\.querySelectorAll\('\[data-create-use-source\]'\)\)/);
  assert.doesNotMatch(script, /data-create-real-enabled/);
  assert.doesNotMatch(script, /El proyecto ya ha comenzado/);
});

test('las líneas viven en Realidad y pueden generarse desde la parte Banco de los usos', () => {
  assert.match(script, /data-generate-create-financing-lines/);
  assert.match(script, /financingLinesFromPlannedUses/);
  assert.match(script, /Generar desde usos previstos/);
  assert.match(script, /Los desembolsos, amortizaciones e intereses se completarán después en Finanzas/);
  assert.doesNotMatch(html, /id="createFinanceLines"/);
  assert.doesNotMatch(script, /data-create-phase-financing="interestRate"/);
  assert.doesNotMatch(script, /data-create-phase-financing="paymentMethod"/);
  assert.doesNotMatch(script, /data-create-phase-financing="commission"/);
});

test('los planos del alta se guardan en la categoría que consume Técnico', () => {
  assert.match(script, /fd\.append\('category', 'architecturalPlans'\)/);
  assert.match(script, /\/api\/documents\/upload\?category=architecturalPlans/);
});
