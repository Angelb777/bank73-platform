'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const projectJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'project.js'), 'utf8');
const themeCss = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'theme.css'), 'utf8');

function sourceBetween(start, end) {
  const from = projectJs.indexOf(start);
  const to = projectJs.indexOf(end, from + start.length);
  assert.notEqual(from, -1, `No se encontró ${start}`);
  assert.notEqual(to, -1, `No se encontró el cierre ${end}`);
  return projectJs.slice(from, to);
}

test('changing a technical permit refreshes the Summary permit chart from the saved data', () => {
  const updateFlow = sourceBetween(
    'async function technicalUpdatePermitStatus',
    'async function technicalPermitDocuments'
  );

  assert.match(updateFlow, /apiPermitsPatchItem\(code, \{ status \}\)/);
  assert.match(updateFlow, /__permits = fresh/);
  assert.match(updateFlow, /updatePermitsByInstitutionChart\(\)/);
  assert.match(updateFlow, /markProjectDataChanged\(\{ refreshSummary:true \}\)/);
});

test('automatic construction and occupation permits feed the chart after Technical loads', () => {
  const chartFlow = sourceBetween('function buildPermitsByInstitution', 'function updatePermitsByInstitutionChart');
  const workspaceFlow = sourceBetween('async function loadTechnicalWorkspace', 'window.refreshTechnicalWorkspace');

  assert.match(chartFlow, /technicalPermitEffectiveStatus\(it\)/);
  assert.match(workspaceFlow, /if \(permits\) __permits = permits/);
  assert.match(workspaceFlow, /updatePermitsByInstitutionChart\(\)/);
});

test('permit cards have compact and explicit light and dark theme styles', () => {
  assert.match(themeCss, /technical-permit-card\{min-height:230px/);
  assert.match(themeCss, /body\.light-theme #tab-tecnico \.technical-permits-section\{[^}]*background:#fff/);
  assert.match(themeCss, /body:not\(\.light-theme\) #tab-tecnico \.technical-permit-state\{[^}]*color:#f8fafc[^}]*color-scheme:dark/);
});
