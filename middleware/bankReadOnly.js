function bankReadOnly(req, res, next) {
  const role = String(req.user?.role || '').toLowerCase();
  const method = String(req.method || 'GET').toUpperCase();
  const path = String(req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '');
  const isProjectCreate = method === 'POST' && path === '/api/projects';

  if (role === 'bank' && !isProjectCreate && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return res.status(403).json({
      error: 'Rol bank en modo observador: esta operacion es solo de lectura.'
    });
  }

  return next();
}

module.exports = bankReadOnly;
