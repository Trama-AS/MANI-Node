const IClientRepository = require('../../domain/ports/IClientRepository');
const { enContextoTenant, fallaDeBase } = require('../db/enContextoTenant');

/**
 * Resolución cliente → usuario por `pg` como `mani_core_svc`, con app.set_context del tenant (SCRUM-1468).
 *
 * Antes probaba primero `core.cliente`, un esquema que no existe en ninguna migración, y caía a `cliente` al fallar;
 * dentro de una transacción con contexto ese primer error abortaría la transacción entera, y además se tragaba
 * cualquier error real devolviendo `null`. Ahora consulta la tabla real y un fallo de la base se informa.
 */
class PostgresClientRepository extends IClientRepository {
  /**
   * @param {object} params
   * @param {import('../db/PgPoolFactory')} [params.pgPoolFactory]
   * @param {import('pg').Pool} [params.pgPool]
   */
  constructor({ pgPoolFactory, pgPool } = {}) {
    super();
    this.pgPoolFactory = pgPool ? { getPool: () => pgPool } : pgPoolFactory;
  }

  async findUsuarioIdByClientId(tenantId, clientId) {
    if (!this.pgPoolFactory || !this.pgPoolFactory.getPool()) return null;
    try {
      const { rows } = await enContextoTenant(this.pgPoolFactory, tenantId, (client) =>
        client.query('SELECT usuario_id FROM cliente WHERE tenant_id = $1 AND id::text = $2 LIMIT 1', [
          tenantId,
          String(clientId),
        ])
      );
      return rows[0]?.usuario_id ?? null;
    } catch (err) {
      throw fallaDeBase('Error consultando el cliente', err);
    }
  }
}

module.exports = PostgresClientRepository;
