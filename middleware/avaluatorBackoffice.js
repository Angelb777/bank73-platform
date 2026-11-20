function denyAvaluatorBackoffice(req, res, next) {
  const role = String(req.user?.role || '').toLowerCase();
  const method = String(req.method || 'GET').toUpperCase();
  if (role === 'avaluador' && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return res.status(403).json({ error: 'El rol avaluador tiene acceso web exclusivamente de lectura.' });
  }

  return next();
}

module.exports = denyAvaluatorBackoffice;
