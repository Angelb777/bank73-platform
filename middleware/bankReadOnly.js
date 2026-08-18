function bankReadOnly(req, res, next) {
  const role = String(req.user?.role || '').toLowerCase();
  const method = String(req.method || 'GET').toUpperCase();
  const path = String(req.originalUrl || req.url || '').split('?')[0].replace(/\/+$/, '');
  const isProjectCreate = method === 'POST' && path === '/api/projects';
  const isFundingInterest = method === 'POST' && /^\/api\/funding\/opportunities\/[^/]+\/interests$/.test(path);
  const isFinanceRequirementUpload = method === 'POST' && path === '/api/documents/upload' && String(req.query?.category || '').toLowerCase() === 'financerequirement';
  const isFinanceRequirementSourceUpdate = method === 'PUT' && /^\/api\/projects\/[^/]+\/finance\/(?:promoter-experience|legal-parties)$/.test(path);

  if (role === 'bank' && !isProjectCreate && !isFundingInterest && !isFinanceRequirementUpload && !isFinanceRequirementSourceUpdate && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return res.status(403).json({
      error: 'Rol bank en modo observador: esta operacion es solo de lectura.'
    });
  }

  return next();
}

module.exports = bankReadOnly;
