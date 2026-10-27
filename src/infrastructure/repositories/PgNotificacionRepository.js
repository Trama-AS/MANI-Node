const INotificacionRepository = require('../../domain/ports/INotificacionRepository');
const { runInTenantContext } = require('../db/runInTenantContext');

// Todas las operaciones corren dentro de runInTenantContext (ADR-0032): con mani_core_svc la política
// notificacion_tenant de la migración 0007 solo deja leer y escribir filas del tenant fijado en el contexto.
class PgNotificacionRepository extends INotificacionRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgNotificacionRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async createForAlly(ctx, { allyId, tipo, canal, payload }) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO notificacion (tenant_id, usuario_id, tipo, canal, payload)
         SELECT $1, a.usuario_id, $3, $4, $5::jsonb
         FROM aliado a
         WHERE a.id = $2 AND a.tenant_id = $1
         RETURNING id, usuario_id`,
        [ctx.tenantId, allyId, tipo, canal, JSON.stringify(payload)]
      );
      return rows.length === 0 ? null : { id: rows[0].id, usuarioId: rows[0].usuario_id };
    });
  }

  async listByRequest(ctx, requestId, tipo) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT payload, enviado_at
         FROM notificacion
         WHERE tenant_id = $1 AND tipo = $2 AND payload->>'requestId' = $3
         ORDER BY enviado_at, id`,
        [ctx.tenantId, tipo, requestId]
      );
      return rows.map((row) => ({ payload: row.payload, enviadoAt: row.enviado_at }));
    });
  }

  async listForUser(ctx, { limit }) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT id, tipo, canal, payload, enviado_at, leido_at
         FROM notificacion
         WHERE tenant_id = $1 AND usuario_id = $2
         ORDER BY enviado_at DESC, id
         LIMIT $3`,
        [ctx.tenantId, ctx.userId, limit]
      );
      return rows.map((row) => ({
        id: row.id,
        tipo: row.tipo,
        canal: row.canal,
        payload: row.payload,
        enviadoAt: row.enviado_at,
        leidoAt: row.leido_at,
      }));
    });
  }
}

module.exports = PgNotificacionRepository;
