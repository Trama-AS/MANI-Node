const IClientRepository = require('../../domain/ports/IClientRepository');

class PostgresClientRepository extends IClientRepository {
  /**
   * @param {object} params
   * @param {import('../db/PgPoolFactory')} [params.pgPoolFactory]
   * @param {import('pg').Pool} [params.pgPool]
   */
  constructor({ pgPoolFactory, pgPool } = {}) {
    super();
    this.pgPoolFactory = pgPoolFactory;
    this.pgPool = pgPool;
  }

  _getPool() {
    if (this.pgPool) return this.pgPool;
    if (this.pgPoolFactory) return this.pgPoolFactory.getPool();
    return null;
  }

  async findUsuarioIdByClientId(tenantId, clientId) {
    const pool = this._getPool();
    if (!pool) return null;

    try {
      // Intento en tabla con prefijo core
      const { rows } = await pool.query(
        `SELECT id_usuario FROM core.cliente WHERE id_tenant = $1 AND id_cliente = $2 LIMIT 1`,
        [tenantId, clientId]
      );
      if (rows.length > 0) return rows[0].id_usuario;
    } catch {
      // Fallback a tabla sin prefijo de esquema
      try {
        const fallback = await pool.query(
          `SELECT usuario_id FROM cliente WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
          [tenantId, clientId]
        );
        return fallback.rows[0]?.usuario_id || null;
      } catch {
        return null;
      }
    }
    return null;
  }
}

module.exports = PostgresClientRepository;
