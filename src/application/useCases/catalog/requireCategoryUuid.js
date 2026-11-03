const { ValidationError } = require('../../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * El identificador de categoría llega del camino de la ruta, así que un valor
 * que no es UUID es un error de contrato y debe rechazarse antes de consultar:
 * PostgreSQL lo convierte en 22P02 y el texto del motor no puede salir al
 * cliente (T9). El catálogo de zonas ya responde así con MANI-ZON-400.
 */
function requireCategoryUuid(value) {
  const id = typeof value === 'string' ? value.trim() : value;
  if (typeof id !== 'string' || !UUID_RE.test(id)) {
    throw new ValidationError('MANI-CAT-400: categoryId debe ser un UUID válido', 'MANI-CAT-400');
  }
  return id;
}

module.exports = requireCategoryUuid;
