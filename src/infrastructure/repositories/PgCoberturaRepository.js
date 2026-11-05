const { DomainError } = require('../../domain/errors/DomainError');
const { runInTenantContext } = require('../db/runInTenantContext');

const noEsAliado = () => new DomainError('MANI-COB-403: solo un aliado activo puede declarar cobertura', 'MANI-COB-403', 403);
const aliadoRechazado = () =>
  new DomainError('MANI-COB-403R: el registro del aliado fue rechazado; no puede declarar cobertura', 'MANI-COB-403R', 403);
const zonaInvalida = () => new DomainError('MANI-COB-422Z: una o más zonas no están disponibles', 'MANI-COB-422Z', 422);

function toZone(row) {
  return { id: row.id, name: row.nombre, level: row.nivel, parentId: row.zona_padre_id ?? null, active: row.estado === 'ACTIVO' };
}

/**
 * Cobertura del aliado (US-02.1.4, SCRUM-1380): reemplaza `obtener_mi_cobertura` y `declarar_cobertura`, que la app
 * llamaba directo a Supabase. Corre en runInTenantContext (ADR-0032), con el tenant, el usuario y el rol del JWT;
 * `cobertura_aliado` tiene RLS por tenant (0007) y `zona` es un catálogo global sin tenant.
 */
class PgCoberturaRepository {
  constructor({ pgPoolFactory }) {
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgCoberturaRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  /** El aliado de la sesión: usuario ACTIVO con rol ALIADO y perfil de aliado en el tenant. */
  async #aliadoActivo(client, ctx, { bloquear = false } = {}) {
    const { rows } = await client.query(
      `SELECT a.id, a.estado_verificacion
         FROM aliado a
         JOIN usuario u ON u.id = a.usuario_id AND u.tenant_id = a.tenant_id
        WHERE a.usuario_id = $1 AND a.tenant_id = $2 AND u.estado = 'ACTIVO' AND u.rol = 'ALIADO'
        ${bloquear ? 'FOR UPDATE OF a' : ''}`,
      [ctx.userId, ctx.tenantId]
    );
    if (rows.length === 0) throw noEsAliado();
    return rows[0];
  }

  async #coberturaDe(client, ctx, aliadoId) {
    const { rows } = await client.query(
      `SELECT z.id, z.nombre, z.nivel, z.zona_padre_id, z.estado
         FROM cobertura_aliado c
         JOIN zona z ON z.id = c.zona_id
        WHERE c.aliado_id = $1 AND c.tenant_id = $2
        ORDER BY z.nombre, z.id`,
      [aliadoId, ctx.tenantId]
    );
    return rows.map(toZone);
  }

  /** Zonas que el aliado de la sesión tiene declaradas (las desactivadas después se devuelven con active=false). */
  obtener(ctx) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const aliado = await this.#aliadoActivo(client, ctx);
      return this.#coberturaDe(client, ctx, aliado.id);
    });
  }

  /**
   * Reemplaza el conjunto completo. Una sola transacción: si una zona no es válida no se borra nada. La fila del
   * aliado se bloquea para serializar dos guardados del mismo aliado.
   * @param {string[]} zonaIds ya sin duplicados y con formato UUID
   */
  declarar(ctx, zonaIds) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const aliado = await this.#aliadoActivo(client, ctx, { bloquear: true });
      if (aliado.estado_verificacion === 'RECHAZADO') throw aliadoRechazado();

      const { rows } = await client.query(
        `SELECT count(*)::int AS total FROM zona WHERE id = ANY($1::uuid[]) AND estado = 'ACTIVO'`,
        [zonaIds]
      );
      if (rows[0].total !== zonaIds.length) throw zonaInvalida();

      // El conjunto enviado reemplaza al anterior: lo que no viene se borra (incluidas las zonas desactivadas después).
      await client.query(`DELETE FROM cobertura_aliado WHERE aliado_id = $1 AND tenant_id = $2 AND zona_id <> ALL($3::uuid[])`, [
        aliado.id,
        ctx.tenantId,
        zonaIds,
      ]);
      await client.query(
        `INSERT INTO cobertura_aliado (tenant_id, aliado_id, zona_id)
         SELECT $1, $2, x FROM unnest($3::uuid[]) AS x
         ON CONFLICT (aliado_id, zona_id) DO NOTHING`,
        [ctx.tenantId, aliado.id, zonaIds]
      );
      return this.#coberturaDe(client, ctx, aliado.id);
    });
  }
}

module.exports = PgCoberturaRepository;
