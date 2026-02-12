module.exports = function requirePin(req, res, options = {}) {
  const { envKey = 'PROCESS_DELETE_PIN' } = options;
  const pinFromEnv = String(process.env[envKey] || '2580');
  const pin = String(req.body?.pin || req.query?.pin || '');
  if (pin !== pinFromEnv) {
    res.status(403).json({ error: 'PIN inválido' });
    return true;
  }
  return false;
};
