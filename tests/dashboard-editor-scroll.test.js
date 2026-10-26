const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboardHtml = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'dashboard.html'),
  'utf8'
);
const dashboardJs = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'js', 'dashboard.js'),
  'utf8'
);

test('superadmin project and promoter editors stay inside the viewport and scroll', () => {
  assert.match(dashboardJs, /id = 'editProjectModal'[\s\S]*?className = 'admin-editor-backdrop'/);
  assert.match(dashboardJs, /id = 'promoterProfileModal'[\s\S]*?className = 'admin-editor-backdrop'/);
  assert.match(dashboardJs, /admin-editor-dialog admin-editor-dialog--project/);
  assert.match(dashboardJs, /admin-editor-dialog admin-editor-dialog--profile/);

  assert.match(dashboardHtml, /\.admin-editor-dialog\s*\{[\s\S]*?max-height:calc\(100dvh - 32px\);/);
  assert.match(dashboardHtml, /\.admin-editor-dialog\s*\{[\s\S]*?overflow-y:auto;/);
  assert.match(dashboardHtml, /@media \(max-width:700px\), \(max-height:600px\)/);
});
