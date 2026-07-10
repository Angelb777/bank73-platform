const path = require('path');
const multer = require('multer');

const MAX_DOCUMENT_FILE_SIZE = 50 * 1024 * 1024;
const MAX_WORD_IMPORT_FILE_SIZE = 10 * 1024 * 1024;
const MAX_EXCEL_IMPORT_FILE_SIZE = 20 * 1024 * 1024;

const DANGEROUS_EXTENSIONS = new Set([
  '.exe',
  '.bat',
  '.cmd',
  '.sh',
  '.js',
  '.html',
  '.php',
  '.svg',
  '.msi',
  '.jar',
  '.ps1'
]);

const MIME_BY_EXTENSION = new Map([
  ['.pdf', new Set(['application/pdf', 'application/octet-stream'])],
  ['.doc', new Set(['application/msword', 'application/octet-stream'])],
  ['.docx', new Set([
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
    'application/octet-stream'
  ])],
  ['.xls', new Set(['application/vnd.ms-excel', 'application/octet-stream'])],
  ['.xlsx', new Set([
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/zip',
    'application/octet-stream'
  ])],
  ['.png', new Set(['image/png'])],
  ['.jpg', new Set(['image/jpeg'])],
  ['.jpeg', new Set(['image/jpeg'])]
]);

const DOCUMENT_EXTENSIONS = new Set(MIME_BY_EXTENSION.keys());
const WORD_IMPORT_EXTENSIONS = new Set(['.doc', '.docx']);
const EXCEL_IMPORT_EXTENSIONS = new Set(['.xls', '.xlsx']);

function normalizeExtension(filename = '') {
  return path.extname(String(filename || '')).toLowerCase();
}

function normalizeUploadFilename(filename = 'documento') {
  const rawBase = path.basename(String(filename || 'documento'));
  const ext = normalizeExtension(rawBase);
  const base = path.basename(rawBase, ext)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 120) || 'documento';

  return `${base}${ext}`;
}

function invalidUploadError() {
  const err = new Error('Archivo no permitido');
  err.status = 400;
  err.expose = false;
  err.code = 'INVALID_UPLOAD_FILE';
  return err;
}

function isAllowedUpload(file, allowedExtensions = DOCUMENT_EXTENSIONS) {
  const ext = normalizeExtension(file?.originalname);
  if (!ext || DANGEROUS_EXTENSIONS.has(ext) || !allowedExtensions.has(ext)) return false;

  const allowedMimes = MIME_BY_EXTENSION.get(ext);
  const mimetype = String(file?.mimetype || '').toLowerCase();
  return Boolean(allowedMimes && allowedMimes.has(mimetype));
}

function fileFilterFor(allowedExtensions = DOCUMENT_EXTENSIONS) {
  return (req, file, cb) => {
    file.originalname = normalizeUploadFilename(file.originalname);
    if (!isAllowedUpload(file, allowedExtensions)) return cb(invalidUploadError());
    cb(null, true);
  };
}

function handleMulterUpload(uploadMiddleware) {
  return (req, res, next) => {
    uploadMiddleware(req, res, (err) => {
      if (!err) return next();

      if (err?.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: 'Archivo demasiado grande.' });
      }

      if (err instanceof multer.MulterError || err?.code === 'INVALID_UPLOAD_FILE') {
        return res.status(400).json({ error: 'Archivo no permitido.' });
      }

      return next(err);
    });
  };
}

module.exports = {
  MAX_DOCUMENT_FILE_SIZE,
  MAX_WORD_IMPORT_FILE_SIZE,
  MAX_EXCEL_IMPORT_FILE_SIZE,
  DOCUMENT_EXTENSIONS,
  WORD_IMPORT_EXTENSIONS,
  EXCEL_IMPORT_EXTENSIONS,
  DANGEROUS_EXTENSIONS,
  fileFilterFor,
  handleMulterUpload,
  normalizeExtension,
  normalizeUploadFilename
};
