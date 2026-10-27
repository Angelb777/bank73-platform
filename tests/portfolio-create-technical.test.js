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
  assert.match(html, /estimación financiera inicial/);
  assert.match(html, /La ejecución real se registrará después/);
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
  assert.match(script, /Inicio previsto<input data-create-phase="startDate" type="date"/);
  assert.match(script, /Fin previsto<input data-create-phase="endDate" type="date"/);
  assert.match(script, /startDate: row\.querySelector\('\[data-create-phase="startDate"\]'\)/);
  assert.match(script, /endDate: row\.querySelector\('\[data-create-phase="endDate"\]'\)/);
  assert.doesNotMatch(script, /Fecha de carta<input data-create-phase-condition="letterDate"/);
  assert.doesNotMatch(script, /Numero o referencia de carta<input data-create-phase-condition="letterReference"/);
});

test('los planos del alta se guardan en la categoría que consume Técnico', () => {
  assert.match(script, /fd\.append\('category', 'architecturalPlans'\)/);
  assert.match(script, /\/api\/documents\/upload\?category=architecturalPlans/);
});
