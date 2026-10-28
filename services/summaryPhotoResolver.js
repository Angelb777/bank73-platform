'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function documentIdFromItem(item = {}) {
  const explicit = String(item?.documentId || item?.docId || item?._id || '').trim();
  if (/^[a-f\d]{24}$/i.test(explicit)) return explicit;
  const source = String(item?.src || item?.dataUrl || item || '');
  const match = /\/api\/documents\/([a-f\d]{24})\/download(?:[?#]|$)/i.exec(source);
  return match?.[1] || '';
}

function safeStoredImagePath(storedPath, projectRoot) {
  const uploadRoot = path.resolve(projectRoot, 'uploads');
  const candidate = path.resolve(projectRoot, String(storedPath || ''));
  const relative = path.relative(uploadRoot, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
  return candidate;
}

async function readAuthorizedProjectImage(item, documents, {
  projectRoot = path.resolve(__dirname, '..'),
  maxBytes = DEFAULT_MAX_IMAGE_BYTES
} = {}) {
  const documentId = documentIdFromItem(item);
  if (!documentId) return null;
  const document = (documents || []).find(entry => String(entry?._id || '') === documentId);
  if (!document || !/^image\/(?:png|jpe?g)$/i.test(String(document.mimetype || ''))) return null;
  const imagePath = safeStoredImagePath(document.path, projectRoot);
  if (!imagePath) return null;

  let stat;
  try {
    stat = await fs.promises.stat(imagePath);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) return null;
  return fs.promises.readFile(imagePath);
}

module.exports = {
  DEFAULT_MAX_IMAGE_BYTES,
  documentIdFromItem,
  readAuthorizedProjectImage,
  safeStoredImagePath
};
