'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('comercial ofrece solo ocho colores oscuros de carpeta', () => {
  const js = read('public/js/project.js');
  const source = js.slice(
    js.indexOf('const COMMERCIAL_FOLDER_COLOR_PALETTE'),
    js.indexOf('function commercialFolderColorRgb')
  );
  const colors = ['#111827', '#1e3a8a', '#172554', '#134e4a', '#14532d', '#581c87', '#881337', '#7c2d12'];
  colors.forEach(color => assert.match(source, new RegExp(color)));
  assert.equal((source.match(/value:'#/g) || []).length, 8);
  assert.match(js, /commercialFolderColorOptions/);
  assert.doesNotMatch(js, /type="color"\s+class="folder-color/);
});

test('el servidor rechaza la paleta libre y normaliza colores anteriores', () => {
  const route = read('routes/commercialFolders.js');
  assert.match(route, /const COMMERCIAL_FOLDER_COLORS = new Set/);
  assert.match(route, /COMMERCIAL_FOLDER_COLORS\.has\(color\) \? color : '#111827'/);
  assert.match(route, /folders: folders\.map/);
  assert.match(route, /commercialUnassignedColor = normalizeCommercialFolderColor/);
  assert.match(route, /update\.color = normalizeCommercialFolderColor/);
});
