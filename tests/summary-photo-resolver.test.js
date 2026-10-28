'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  documentIdFromItem,
  readAuthorizedProjectImage,
  safeStoredImagePath
} = require('../services/summaryPhotoResolver');

const DOC_ID = '64b000000000000000000001';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

test('el PDF resuelve una foto autorizada desde el almacenamiento del proyecto', async t => {
  const projectRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'bank73-summary-photo-'));
  t.after(() => fs.promises.rm(projectRoot, { recursive: true, force: true }));
  await fs.promises.mkdir(path.join(projectRoot, 'uploads'));
  await fs.promises.writeFile(path.join(projectRoot, 'uploads', 'before.png'), PNG);

  const result = await readAuthorizedProjectImage(
    { documentId: DOC_ID, src: `https://bank73.test/api/documents/${DOC_ID}/download` },
    [{ _id: DOC_ID, path: 'uploads/before.png', mimetype: 'image/png' }],
    { projectRoot }
  );
  assert.deepEqual(result, PNG);
});

test('mantiene compatibilidad con URLs antiguas que no incluyen documentId separado', () => {
  assert.equal(documentIdFromItem({ src: `/api/documents/${DOC_ID}/download` }), DOC_ID);
  assert.equal(documentIdFromItem({ src: `https://bank73.test/api/documents/${DOC_ID}/download?preview=1` }), DOC_ID);
});

test('no permite leer una ruta fuera de uploads ni un documento ajeno', async () => {
  const projectRoot = path.join(os.tmpdir(), 'bank73-photo-safety');
  assert.equal(safeStoredImagePath('../secret.png', projectRoot), null);
  assert.equal(await readAuthorizedProjectImage(
    { documentId: DOC_ID },
    [{ _id: '64b000000000000000000002', path: 'uploads/other.png', mimetype: 'image/png' }],
    { projectRoot }
  ), null);
});

test('la interfaz envía el identificador y el exportador usa la lectura autorizada', () => {
  const frontend = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'project.js'), 'utf8');
  const route = fs.readFileSync(path.join(__dirname, '..', 'routes', 'projects.js'), 'utf8');
  assert.match(frontend, /documentId:\s*String\(d\._id/);
  assert.match(route, /readAuthorizedProjectImage\(\{ \.\.\.item, src \}, documents\)/);
});
