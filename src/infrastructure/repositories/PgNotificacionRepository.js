const INotificacionRepository = require('../../domain/ports/INotificacionRepository');
const requirePool = require('../db/requirePool');

class PgNotificacionRepository extends INotificacionRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgNotificacionRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async createForAlly({ tenantId, allyId, tipo, canal, payload }) {
    const pool = requirePool(this.pgPoolFactory);
    const { rows } = await pool.query(
      `INSERT INTO notificacion (tenant_id, usuario_id, tipo, canal, payload)
       SELECT $1, a.usuario_id, $3, $4, $5::jsonb
       FROM aliado a
       WHERE a.id = $2 AND a.tenant_id = $1
       RETURNING id, usuario_id`,
      [tenantId, allyId, tipo, canal, JSON.stringify(payload)]
    );
    return rows.length === 0 ? null : { id: rows[0].id, usuarioId: rows[0].usuario_id };
  }

  async listByRequest(tenantId, requestId, tipo) {
    const pool = requirePool(this.pgPoolFactory);
    const { rows } = await pool.query(
      `SELECT payload, enviado_at
       FROM notificacion
       WHERE tenant_id = $1 AND tipo = $2 AND payload->>'requestId' = $3
       ORDER BY enviado_at, id`,
      [tenantId, tipo, requestId]
    );
    return rows.map((row) => ({ payload: row.payload, enviadoAt: row.enviado_at }));
  }

  async listForUser(tenantId, usuarioId, { limit }) {
    const pool = requirePool(this.pgPoolFactory);
    const { rows } = await pool.query(
      `SELECT id, tipo, canal, payload, enviado_at, leido_at
       FROM notificacion
       WHERE tenant_id = $1 AND usuario_id = $2
       ORDER BY enviado_at DESC, id
       LIMIT $3`,
      [tenantId, usuarioId, limit]
    );
    return rows.map((row) => ({
      id: row.id,
      tipo: row.tipo,
      canal: row.canal,
      payload: row.payload,
      enviadoAt: row.enviado_at,
      leidoAt: row.leido_at,
    }));
  }
}

module.exports = PgNotificacionRepository;
