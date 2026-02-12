module.exports = function errorHandler(err, req, res, next) {
  console.error('[Error]', err);
  res.status(err.status || 500).json({ error: err.message || 'Error interno' });
};
