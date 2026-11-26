const crypto = require('crypto');

function expectedDeletePin() {
  return String(
    process.env.DELETE_PIN ||
    process.env.PROCESS_DELETE_PIN ||
    process.env.DELETE_DOCS_PIN ||
    process.env.FINANCE_DELETE_PIN ||
    process.env.ADMIN_PIN ||
    '2580'
  ).trim();
}

function providedDeletePin(req) {
  return String(
    req.headers?.['x-delete-pin'] ||
    req.body?.pin ||
    req.body?.deletePin ||
    req.query?.pin ||
    ''
  ).trim();
}

function validDeletePin(req) {
  const provided = Buffer.from(providedDeletePin(req));
  const expected = Buffer.from(expectedDeletePin());
  return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
}

function isDestructiveRequest(req) {
  const method = String(req.method || '').toUpperCase();
  const path = String(req.path || req.originalUrl || '').split('?')[0].replace(/\/+$/, '');
  return method === 'DELETE' || (method === 'POST' && /\/delete$/i.test(path));
}

function requireDeletePin(req, res, next) {
  if (!isDestructiveRequest(req)) return next();
  if (!validDeletePin(req)) return res.status(403).json({ error: 'PIN de eliminación incorrecto.' });
  req.deletePinVerified = true;
  return next();
}

module.exports = {
  expectedDeletePin,
  providedDeletePin,
  validDeletePin,
  isDestructiveRequest,
  requireDeletePin
};
