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

  // T9 (fallo cerrado, sin detalle interno). Lo que decide si el mensaje sale
  // no es el código HTTP, sino si el error estaba previsto: un error de
  // dominio fija su statusCode y su mensaje está escrito para el cliente,
  // incluso cuando es 503 (Rules no disponible) o 504 (timeout del
  // proveedor). Lo que llega sin statusCode es una falla no prevista —por
  // ejemplo un SQLSTATE de PostgreSQL, cuyo texto nombra tablas, columnas y
  // tipos— y ese mensaje no puede salir en la respuesta. El error completo
  // queda en el console.error de arriba, que es donde hay que leerlo.
  const isUnexpected = !Number.isInteger(err.statusCode) && !isMulterError;
  const code = isMulterError ? 'VALIDATION_ERROR' : (isUnexpected ? 'INTERNAL_ERROR' : err.code);
  const message = isUnexpected
    ? 'Error interno del servidor'
    : (err.message || 'Error interno del servidor');

  res.status(statusCode).json({
    error: message,
    code,
    ...(!isUnexpected && Array.isArray(err.violations) && { violations: err.violations }),
    correlationId: req.correlationId || 'none',
  });
}

module.exports = { notFoundHandler, errorHandler };
