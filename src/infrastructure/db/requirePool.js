const { DomainError } = require('../../domain/errors/DomainError');

/** Pool de PostgreSQL o 503: estas consultas no tienen respaldo en memoria ni valores por omisión. */
function requirePool(pgPoolFactory) {
  const pool = pgPoolFactory.getPool();
  if (!pool) {
    throw new DomainError('MANI-DSP-503: la base de datos no está configurada (DATABASE_URL)', 'SERVICE_UNAVAILABLE', 503);
  }
  return pool;
}

module.exports = requirePool;
