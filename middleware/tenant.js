// middleware/tenant.js
module.exports = function tenant(req, res, next) {
  let t = (req.header('X-Tenant') || '').trim();
  // fallback útil en dev
  if (!t) t = 'bancodemo';

  if (t !== 'bancodemo') {
    return res.status(403).json({ error: 'Tenant no permitido' });
  }
  req.tenantKey = t;
  next();
};
