const { DomainError } = require('../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ejecuta una unidad de trabajo dentro de una transacción PostgreSQL (`pg`)
 * fijando como primera sentencia el contexto de identidad verificado con
 * `SELECT app.set_context($1, $2, $3)` (ADR-0032, `02-diseno-modelo-identidad.md` §6).
 *
 * Garantías:
 *   1. El contexto vive con `is_local = true` y muere al confirmar (`COMMIT`)
 *      o revertir (`ROLLBACK`) la transacción, sin filtrarse a la siguiente
 *      petición que reutilice la conexión del pool.
 *   2. Falla cerrada (`MANI-RLS-400`) si `tenantId` está ausente o no es un UUID
 *      válido antes de tocar los datos de negocio.
 *   3. Si `ROLLBACK` falla tras un error, descarta la conexión del pool pasando
 *      el error a `client.release(releaseError)`.
 *
 * @param {object} pool Pool de `pg` (con método `.connect()`).
 * @param {object} context Contexto verificado (`{ tenantId, userId = null, role = null }`).
 * @param {(client: object) => Promise<any>} work Función que recibe el `client` transaccional.
 */
async function withTenantContext(pool, { tenantId, userId = null, role = null } = {}, work) {
  if (!pool || typeof pool.connect !== 'function') {
    throw new DomainError('Pool de PostgreSQL no configurado para withTenantContext', 'INTERNAL_ERROR', 500);
  }
  if (typeof work !== 'function') {
    throw new Error('work debe ser una función en withTenantContext');
  }
  if (!tenantId || !UUID_RE.test(String(tenantId))) {
    throw new DomainError('MANI-RLS-400: el contexto exige tenant_id válido', 'MANI-RLS-400', 400);
  }
  if (userId !== null && userId !== undefined && !UUID_RE.test(String(userId))) {
    throw new DomainError('MANI-RLS-400: user_id inválido en contexto de identidad', 'MANI-RLS-400', 400);
  }

  const normalizedRole = role ? String(role).trim().toLowerCase() : null;
  const client = await pool.connect();
  let releaseError;

  try {
    await client.query('BEGIN');
    await client.query('SELECT app.set_context($1, $2, $3)', [tenantId, userId ?? null, normalizedRole]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackErr) {
      releaseError = rollbackErr;
    }
    throw err;
  } finally {
    client.release(releaseError);
  }
}

module.exports = { withTenantContext };
