function denyAvaluatorBackoffice(req, res, next) {
  if (String(req.user?.role || '').toLowerCase() === 'avaluador') {
    return res.status(403).json({ error: 'El rol avaluador no tiene acceso al backoffice.' });
  }

  return next();
}

module.exports = denyAvaluatorBackoffice;
