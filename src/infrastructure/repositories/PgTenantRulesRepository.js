const ITenantRulesRepository = require('../../domain/ports/ITenantRulesRepository');
const { ConflictError } = require('../../domain/errors/DomainError');
const { runInTenantContext } = require('../db/runInTenantContext');
const { REGLAS_POR_OMISION } = require('../../domain/rules/tenantRulesDefaults');

const COLUMNAS = 'id, version, reglas, estado, creado_por, actor_rol, correlation_id, created_at';

function auditoria(row) {
  return {
    creadoPor: row.creado_por,
    actorRol: row.actor_rol,
    correlationId: row.correlation_id,
    creadaEn: row.created_at,
  };
}

function toReglaVigente(row) {
  if (!row) {
    return { version: 0, origen: 'POR_OMISION', reglas: REGLAS_POR_OMISION };
  }
  return { id: row.id, version: row.version, origen: 'PROPIO', reglas: row.reglas, estado: row.estado, auditoria: auditoria(row) };
}

function toHistorialItem(row) {
  return { id: row.id, version: row.version, estado: row.estado, reglas: row.reglas, auditoria: auditoria(row) };
}

/**
 * Reglas operativas por tenant sobre `pg` con withTenantContext (ADR-0032): toda consulta filtra por el tenant del JWT
 * además de RLS (migración 0031). Guardar una versión nueva (archivar la vigente e insertar la siguiente) va en la
 * transacción de runInTenantContext: un error deja intacta la versión vigente (C2).
 */
class PgTenantRulesRepository extends ITenantRulesRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgTenantRulesRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async getVigente(ctx) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT ${COLUMNAS} FROM regla_tenant WHERE tenant_id = $1 AND estado = 'VIGENTE'`,
        [ctx.tenantId]
      );
      return toReglaVigente(rows[0]);
    });
  }

  async getHistorial(ctx) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT ${COLUMNAS} FROM regla_tenant WHERE tenant_id = $1 ORDER BY version DESC`,
        [ctx.tenantId]
      );
      return rows.map(toHistorialItem);
    });
  }

  async saveNuevaVersion(ctx, { expectedVersion, reglas, correlationId }) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      // El tenant se bloquea para que dos guardados simultáneos sobre la versión 0 no inserten dos versiones 1.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`regla_tenant:${ctx.tenantId}`]);
      const actual = await client.query(
        "SELECT id, version FROM regla_tenant WHERE tenant_id = $1 AND estado = 'VIGENTE' FOR UPDATE",
        [ctx.tenantId]
      );
      const actualVersion = actual.rows.length ? actual.rows[0].version : 0;
      if (Number(expectedVersion) !== actualVersion) {
        throw new ConflictError(
          `MANI-RGL-409C: la versión esperada (${expectedVersion}) no coincide con la versión vigente (${actualVersion})`,
          'MANI-RGL-409C'
        );
      }
      if (actual.rows.length) {
        await client.query("UPDATE regla_tenant SET estado = 'HISTORICA' WHERE id = $1 AND tenant_id = $2", [
          actual.rows[0].id,
          ctx.tenantId,
        ]);
      }
      const { rows } = await client.query(
        `INSERT INTO regla_tenant (tenant_id, version, reglas, estado, creado_por, actor_rol, correlation_id)
         VALUES ($1, $2, $3::jsonb, 'VIGENTE', $4, $5, $6)
         RETURNING ${COLUMNAS}`,
        [ctx.tenantId, actualVersion + 1, JSON.stringify(reglas), ctx.userId, ctx.role, correlationId]
      );
      return toReglaVigente(rows[0]);
    });
  }
}

module.exports = PgTenantRulesRepository;
