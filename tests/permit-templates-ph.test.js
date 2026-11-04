'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf8');
const seed = read('scripts', 'seed-permits.js');
const portfolioJs = read('public', 'js', 'portfolio.js');
const projectJs = read('public', 'js', 'project.js');

test('the permit seed includes distinct horizontal and vertical PH templates', () => {
  assert.match(seed, /name: 'PH Vertical'/);
  assert.match(seed, /projectTypes: \['Residencial vertical PH', 'PH vertical'\]/);
  assert.match(seed, /name: 'PH Horizontal'/);
  assert.match(seed, /projectTypes: \['Lotes, adosados y dúplex PH', 'PH horizontal'\]/);
  assert.match(seed, /code: 'phv-regimen-miviot'/);
  assert.match(seed, /code: 'phh-regimen-miviot'/);
  assert.match(seed, /code: 'phh-revision-previa-miviot'/);
  assert.match(seed, /code: 'phh-plano-finca-anati'/);
  assert.match(seed, /code: 'phv-eia-miambiente'/);
  assert.match(seed, /La construcción de todas las viviendas no es requisito previo/);
  assert.match(seed, /Decreto Ejecutivo 4 de 28 de mayo de 2026/);
  assert.match(seed, /tasa de tramitación equivalente a 0\.2%/);
});

test('Create Project loads every permit template and recommends the exact project type match', () => {
  assert.match(portfolioJs, /API\.get\('\/api\/permits\/templates'\)/);
  assert.match(portfolioJs, /function createPermitTemplateScore/);
  assert.match(portfolioJs, /template\?\.projectTypes/);
  assert.match(portfolioJs, /★ Recomendada/);
  assert.match(portfolioJs, /getElementById\('pProjectType'\)\?\.addEventListener\('change'/);
});

test('Technical supports and orders the new PH permit phases', () => {
  assert.match(projectJs, /function technicalRecommendedTemplate/);
  assert.match(projectJs, /template\?\.projectTypes/);
  assert.match(projectJs, /'Certificación de Uso de Suelo'/);
  assert.match(projectJs, /'Calificación PH Horizontal'/);
  assert.match(projectJs, /'Estudio de Impacto Ambiental'/);
  assert.match(projectJs, /'Régimen de Propiedad Horizontal'/);
  assert.match(projectJs, /'Plano de Finca en PH'/);
  assert.match(projectJs, /'Inscripción de PH'/);
});

test('the permit seed includes an independent commercial template with conditional approvals', () => {
  assert.match(seed, /name: 'Proyecto Comercial'/);
  assert.match(seed, /projectTypes: \['Comercial', 'Proyecto comercial'\]/);
  assert.match(seed, /code: 'com-eia-miambiente'/);
  assert.match(seed, /code: 'com-movilidad-attt'/);
  assert.match(seed, /code: 'com-sanitario-minsa'/);
  assert.match(seed, /code: 'com-aviso-operacion-mici'/);
  assert.match(projectJs, /'Estudio de Movilidad'/);
  assert.match(projectJs, /'Permisos de Operación'/);
});

test('waived conditional permits satisfy dependencies', () => {
  assert.match(projectJs, /\['approved', 'waived'\]\.includes\(idx\[code\]\.status\)/);
  assert.match(projectJs, /\['approved', 'waived'\]\.includes\(status\)/);
});
