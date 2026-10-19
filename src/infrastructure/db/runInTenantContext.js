const { DomainError } = require('../../domain/errors/DomainError');
const { withTenantContext } = require('./withTenantContext');
const { domainRoleToClaim } = require('../security/claimRoleMap');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Ejecuta `work(client)` en una transacción con el contexto de identidad verificado (ADR-0032):
 * tenant del JWT, usuario (solo si es un UUID) y rol en el vocabulario del claim (`aliado`, `cliente`,
 * `admin_tenant`), que es el que comparan las políticas RLS de la migración 0007.
 * Sin DATABASE_URL falla cerrado con 503: estos repositorios no tienen respaldo.
 */
async function runInTenantContext(pgPoolFactory, ctx = {}, work) {
  const pool = pgPoolFactory.getPool();
  if (!pool) {
    throw new DomainError('MANI-SRV-503: la base de datos no está configurada (DATABASE_URL)', 'SERVICE_UNAVAILABLE', 503);
  }
  return withTenantContext(
    pool,
    {
      tenantId: ctx.tenantId,
      userId: ctx.userId && UUID_RE.test(String(ctx.userId)) ? ctx.userId : null,
      role: ctx.role ? domainRoleToClaim(ctx.role) : null,
    },
    work
  );
}

module.exports = { runInTenantContext };
