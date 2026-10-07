function notFoundHandler(req, res) {
  res.status(404).json({
    error: 'Ruta no encontrada en MANI-Core-Node',
    correlationId: req.correlationId || 'none',
  });
}

function errorHandler(err, req, res, _next) {
  console.error(err);

  // Multer rechaza campos/archivos fuera de lo configurado (p. ej.
  // LIMIT_UNEXPECTED_FILE cuando el whitelist de auth.routes.js no incluye
  // ese campo) con un MulterError genérico sin statusCode: es un error del
  // cliente (400), no una falla interna (500 por defecto).
  // MulterError trae su propio err.code (p. ej. 'LIMIT_UNEXPECTED_FILE'), que
  // no es parte del catálogo ErrorCode del contrato: se reemplaza siempre
  // por VALIDATION_ERROR en vez de dejarlo pasar.
  const isMulterError = err.name === 'MulterError';
  const statusCode = err.statusCode || (isMulterError ? 400 : 500);
  const code = isMulterError ? 'VALIDATION_ERROR' : err.code;

  res.status(statusCode).json({
    error: err.message || 'Error interno del servidor',
    code,
    correlationId: req.correlationId || 'none',
  });
}

module.exports = { notFoundHandler, errorHandler };
