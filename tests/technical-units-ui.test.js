const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('Técnico comparte los flujos canónicos de creación y protege el borrado con PIN', () => {
  const html = read('public/project.html');
  const js = read('public/js/project.js');
  const rbac = read('middleware/rbac.js');
  const units = read('routes/units.js');

  assert.match(html, /id="technicalCreateUnits"/);
  assert.match(html, /id="technicalCreateModel"/);
  assert.match(html, /id="technicalDeleteUnits"/);
  assert.match(js, /openSharedCreateUnits\?\.\('technical'\)/);
  assert.match(js, /openSharedModelsManager\?\.\('technical'\)/);
  assert.match(js, /fetch\('\/api\/units\/batch',[\s\S]*method:'DELETE'/);
  assert.match(units, /const bad = requirePin\(req, res\)/);
  assert.match(rbac, /canCreateTechnicalUnits/);
  assert.match(rbac, /canDeleteTechnicalUnits/);
  assert.match(rbac, /canManageTechnicalModels/);
});

test('la tarjeta técnica usa el estado de obra como acento y conserva el estado comercial', () => {
  const js = read('public/js/project.js');
  const css = read('public/css/theme.css');

  assert.match(js, /function technicalConstructionTone/);
  assert.match(js, /construction-\$\{escapeHtml\(constructionTone\)\}/);
  assert.match(js, /technicalUnitStateLabel\(unit\.estado/);
  assert.match(css, /\.construction-pending\{--accent:#f59e0b\}/);
  assert.match(css, /\.construction-in-progress\{--accent:#38bdf8\}/);
  assert.match(css, /\.construction-completed\{--accent:#22c55e\}/);
  assert.match(css, /\.technical-construction-state/);
  assert.match(css, /\.technical-signal/);
});

test('faseConstruccion deja de ser un campo editable en Comercial y Técnico', () => {
  const html = read('public/project.html');
  const js = read('public/js/project.js');
  const ventas = read('routes/ventas.js');

  assert.doesNotMatch(html, /id="b-faseConstruccion"/);
  assert.doesNotMatch(js, /id="technicalBatchPhase"/);
  assert.doesNotMatch(js, /fv-faseConstruccion/);
  assert.doesNotMatch(ventas.match(/const TECHNICAL_FIELDS[\s\S]*?\]\);/)?.[0] || '', /faseConstruccion/);
});

test('los flujos técnicos no pueden sobrescribir el precio de lista', () => {
  const units = read('routes/units.js');
  const projects = read('routes/projects.js');
  const css = read('public/css/theme.css');

  assert.match(units, /delete modelFields\.precioLista/);
  assert.match(units, /delete modelFields\.price/);
  assert.match(projects, /model\.price = Number\(existing\?\.price \|\| 0\)/);
  assert.match(css, /data-launch-context="technical"/);
});
