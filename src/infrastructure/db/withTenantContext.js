const { DomainError } = require('../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SET_CONTEXT = 'SELECT app.set_context($1, $2, $3)';
const SET_CONTEXT_WITH_CORRELATION = "SELECT app.set_context($1, $2, $3), set_config('app.correlation_id', $4, true)";

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
 * @param {object} context Contexto verificado (`{ tenantId, userId = null, role = null, correlationId = null }`).
 *        `correlationId` queda en `app.correlation_id` (local a la transacción) para la trazabilidad (SCRUM-1657),
 *        fijado en la misma sentencia que el contexto (SCRUM-1652).
 * @param {(client: object) => Promise<any>} work Función que recibe el `client` transaccional.
 */
async function withTenantContext(pool, { tenantId, userId = null, role = null, correlationId = null } = {}, work) {
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
    if (correlationId) {
      // Contexto y correlación en una sola sentencia: cada sentencia es un viaje a la base, y en QA cada viaje cuesta
      // ~110 ms (SCRUM-1652). is_local = true: la correlación muere con la transacción, igual que el contexto.
      await client.query(SET_CONTEXT_WITH_CORRELATION, [
        tenantId,
        userId ?? null,
        normalizedRole,
        String(correlationId).slice(0, 128),
      ]);
    } else {
      await client.query(SET_CONTEXT, [tenantId, userId ?? null, normalizedRole]);
    }
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
