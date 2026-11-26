module.exports = function requirePin(req, res, options = {}) {
  if (req.deletePinVerified) return false;
  const { validDeletePin } = require('./deletePin');
  if (!validDeletePin(req)) {
    res.status(403).json({ error: 'PIN inválido' });
    return true;
  }
  return false;
};
