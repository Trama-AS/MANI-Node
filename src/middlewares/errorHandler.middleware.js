function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Ruta no encontrada en MANI-Core-Node',
    correlationId: req.correlationId || 'none',
  });
}

function errorHandler(err, req, res, _next) {
  console.error(err);
  res.status(err.statusCode || 500).json({
    error: err.message || 'Error interno del servidor',
    code: err.code,
    correlationId: req.correlationId || 'none',
  });
}

module.exports = { notFoundHandler, errorHandler };
