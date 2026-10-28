const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'routes', 'projects.js'), 'utf8');

test('el PDF ejecutivo integra la matriz dentro de Resumen Legal', () => {
  const matrixFunction = source.slice(
    source.indexOf('function drawLegalProgressMatrix'),
    source.indexOf('async function drawBeforeAfter')
  );
  assert.match(matrixFunction, /sectionTitle\(doc, 'Resumen Legal'\)/);
  assert.ok(
    source.lastIndexOf('drawLegalProgressMatrix(doc, datasets.legal, executiveMeta)')
      > source.indexOf('for (const sec of CHART_ORDER)'),
    'la matriz debe emitirse al recorrer la seccion legal'
  );
});

test('el PDF clasifica las graficas financieras y no crea Otras graficas', () => {
  assert.match(source, /normalized\.startsWith\('desviacion temporal - '\)/);
  assert.match(source, /normalized\.startsWith\('grafica lineas fase '\)/);
  assert.doesNotMatch(source, /sectionTitle\(doc, 'Otras gr[aá]ficas'\)/);
});
