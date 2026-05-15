module.exports = function errorHandler(err, req, res, next) {
  console.error('[Error]', err);

  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      error: 'Archivo demasiado grande para esta operación.'
    });
  }

  if (err?.name === 'MulterError') {
    return res.status(400).json({
      error: err.message || 'Error procesando la subida de archivos.'
    });
  }

  res.status(err.status || 500).json({ error: err.message || 'Error interno' });
};
