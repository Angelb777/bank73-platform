const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relativePath => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

test('project creation presents a scoped initial state instead of global dynamic progress', () => {
  const html = read('public/portfolio.html');
  const js = read('public/js/portfolio.js');

  assert.match(html, /data-create-step="progress"[^>]*>[\s\S]*?Estado inicial/);
  assert.match(html, /Contratistas y Obra[\s\S]*?paquetes con rango de unidades/);
  assert.match(html, /Escrituración[\s\S]*?proceso comercial de cada unidad/);
  assert.match(js, /filter\(step => isInitialStatePhase\(step\?\.phase\)\)/);
  assert.match(js, /PRE_ESTUDIOS[\s\S]*?PERMISOS[\s\S]*?FINANCIACION/);
});

test('the server cannot complete unit-scoped phases as global initial progress', () => {
  const route = read('routes/projects.js');

  assert.match(route, /const allowedCompletedKeys = new Set/);
  assert.match(route, /isInitialStatePhase\(step\?\.phase\) && completedKeys\.has\(step\.key\)/);
  assert.match(route, /const isDone = allowedCompletedKeys\.has\(step\.key\)/);
  assert.match(route, /templateKey: \{ \$in: Array\.from\(allowedRequestedKeys\) \}/);
});
