'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('la ficha muestra un único cargador múltiple por cada etapa comercial', () => {
  const js = read('public/js/project.js');
  const processSource = js.slice(
    js.indexOf('function renderCommercialProcessFicha'),
    js.indexOf('function renderTechnicalUnitFicha')
  );

  assert.match(js, /const COMMERCIAL_SALE_STAGE_DOC_PREFIX = 'commercialSaleStage:'/);
  assert.match(js, /multiple data-sale-stage-file/);
  assert.match(processSource, /commercialSaleStageAttachmentHtml\(num\)/);
  assert.doesNotMatch(processSource, /addCommercialSaleFieldAttachments/);
  assert.doesNotMatch(js, /data-sale-field-upload/);
  assert.doesNotMatch(js, /commercialSaleFieldAttachmentHtml/);
});

test('los adjuntos antiguos por campo se agrupan en su etapa sin perderse', () => {
  const js = read('public/js/project.js');
  assert.match(js, /function commercialSaleDocumentStage/);
  assert.match(js, /category\.startsWith\(COMMERCIAL_SALE_FIELD_DOC_PREFIX\)/);
  assert.match(js, /fieldId === 'fv-polizas' \|\| fieldId\.startsWith\('pagare-'\)/);
  assert.match(js, /COMMERCIAL_STAGE_FIELD_IDS\.findIndex/);
});
