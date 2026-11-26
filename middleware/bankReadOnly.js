function bankReadOnly(req, res, next) {
  const role = String(req.user?.role || '').toLowerCase();
  const method = String(req.method || 'GET').toUpperCase();
  const path = String(req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '');
  const isProjectCreate = method === 'POST' && path === '/api/projects';
  const bodyKeys = Object.keys(req.body || {});
  const isProjectMediaUpdate = method === 'PUT'
    && /^\/api\/projects\/[^/]+$/.test(path)
    && bodyKeys.length > 0
    && bodyKeys.every(key => ['coverImage', 'logoImage'].includes(key));

  if (role === 'bank' && !isProjectCreate && !isProjectMediaUpdate && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return res.status(403).json({
      error: 'Rol bank en modo observador: esta operacion es solo de lectura.'
    });
  }

  return next();
}

module.exports = bankReadOnly;
