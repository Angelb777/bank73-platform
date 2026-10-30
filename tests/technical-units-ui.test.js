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

test('la fase de construcción se edita una sola vez desde la ficha por proceso', () => {
  const html = read('public/project.html');
  const js = read('public/js/project.js');
  const ventas = read('routes/ventas.js');

  assert.doesNotMatch(html, /id="b-faseConstruccion"/);
  assert.doesNotMatch(js, /id="technicalBatchPhase"/);
  assert.match(js, /id="fv-estatusConstruccion"|fv-estatusConstruccion/);
  assert.match(ventas.match(/const TECHNICAL_FIELDS[\s\S]*?\]\);/)?.[0] || '', /faseConstruccion/);
});

test('el resumen técnico mantiene la gráfica de fase alimentada por el estatus de obra actual', () => {
  const html = read('public/project.html');
  const js = read('public/js/project.js');
  const projects = read('routes/projects.js');

  assert.match(html, /id="sumConstructionStatus"/);
  assert.match(html, /id="sumConstructionPhase"|<h3>Fase de construcción<\/h3>/);
  assert.match(js, /sumConstructionPhase/);
  assert.doesNotMatch(js, /ventaUpdate\.faseConstruccion|faseConstruccion:\s*vVal/);
  assert.match(projects, /clean\(venta\?\.estatusConstruccion\)\s*\|\|\s*clean\(venta\?\.faseConstruccion\)/);
  assert.match(projects, /constructionPhaseMap\.set\(estatusConstruccion/);
});

test('precioVenta es la fuente comercial única y no vive en Unit', () => {
  const units = read('routes/units.js');
  const projects = read('routes/projects.js');
  const css = read('public/css/theme.css');

  const unitModel = read('models/Unit.js');
  assert.doesNotMatch(unitModel, /precioLista/);
  assert.match(units, /precioVenta/);
  assert.doesNotMatch(units, /precioLista/);
  assert.match(projects, /model\.price = Number\(existing\?\.price \|\| 0\)/);
  assert.match(css, /data-launch-context="technical"/);
});

test('la ficha técnica comparte los campos canónicos de unidad y construcción con Comercial', () => {
  const js = read('public/js/project.js');
  const from = js.indexOf('function renderTechnicalUnitFicha');
  const to = js.indexOf('const COMMERCIAL_STAGE_FIELD_IDS', from);
  const technicalFicha = js.slice(from, to);

  for (const field of [
    'fu-etapa', 'fu-torre', 'fu-nivel', 'fu-modeloSelect', 'fu-m2',
    'fv-numeroFinca', 'fv-codigoUbicacion', 'fv-calle', 'fv-areaAbierta',
    'fv-areaCerrada', 'fv-areaTotalConstruccion', 'fv-recamaras', 'fv-banos',
    'fv-avanceConstruccionPct', 'fv-estatusConstruccion',
    'fv-permisoConstruccionMunicipal', 'fv-permisoConstruccionNum',
    'fv-permisoConstruccionVencimiento', 'fv-permisoOcupacion',
    'fv-permisoOcupacionNum', 'fv-fechaEmisionPermisoOcupacion', 'fv-constructora'
  ]) assert.match(technicalFicha, new RegExp(field));

  assert.doesNotMatch(technicalFicha, /fv-metrosExtra|fv-precioM2Extra|fv-valorMejoras|fv-valorTerreno|fv-enConstruccion/);
  assert.match(js, /fichaMode === 'technical'[\s\S]*renderTechnicalUnitFicha\(u, v, unitId\)/);
});

test('la ficha técnica es plegable y las pólizas no se solapan', () => {
  const js = read('public/js/project.js');
  const css = read('public/css/theme.css');

  assert.match(js, /technical-process-shell/);
  assert.match(js, /technical-policy-card/);
  assert.match(js, /insurance-policy-card-head/);
  assert.match(css, /\.insurance-policy-card-head \{[^}]*flex-wrap:wrap/);
  assert.match(css, /\.insurance-policy-card-grid \{[^}]*auto-fit[^}]*minmax\(130px,1fr\)/);
  assert.match(css, /#fichaUnidadModal \.insurance-policy-card \{[^}]*overflow:hidden/);
});

test('Técnico hidrata las características desde el mismo modelo que Comercial', () => {
  const js = read('public/js/project.js');
  const binding = js.slice(
    js.indexOf("const fichaModelSelect = document.getElementById('fu-modeloSelect')"),
    js.indexOf("const unitCostInput = document.getElementById('fu-costo')")
  );

  assert.match(binding, /if \(fichaModelSelect\?\.value\)/);
  assert.match(binding, /applyProjectModelToFicha\(fichaModelSelect\.value, \{ onlyMissing:true \}\)/);
  assert.doesNotMatch(binding, /fichaMode === 'commercial'/);
});

test('Técnico conserva contraste diurno y una cabecera sin solapes', () => {
  const js = read('public/js/project.js');
  const css = read('public/css/theme.css');

  assert.match(js, /classList\.toggle\('is-technical', fichaMode === 'technical'\)/);
  assert.match(css, /body\.light-theme #tab-tecnico \.commercial-folder-head h3/);
  assert.match(css, /#fichaUnidadModal\.is-technical \.unit-title-project-name \{ grid-column:1\/-1; grid-row:1; \}/);
  assert.match(css, /#fichaUnidadModal\.is-technical \.unit-title-identity \{ grid-column:1; grid-row:2; justify-self:start; width:max-content; \}/);
  assert.match(css, /#fichaUnidadModal\.is-technical \.unit-title-status \{ grid-column:2; grid-row:2;/);
});
