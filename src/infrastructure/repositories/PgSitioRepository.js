const ISitioRepository = require('../../domain/ports/ISitioRepository');
const { enContextoTenant, consultaGlobal, filaPlana, fallaDeBase } = require('../db/enContextoTenant');

/**
 * Sitio inicial del cliente en el registro, por `pg` como `mani_core_svc` (SCRUM-1468). `sitio` es por tenant y corre
 * con app.set_context; la zona por omisión sale del catálogo global `zona`, que no depende del tenant.
 */
class PgSitioRepository extends ISitioRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgSitioRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async findFirstActiveZonaId() {
    try {
      const { rows } = await consultaGlobal(this.pgPoolFactory, "SELECT id FROM zona WHERE estado = 'ACTIVO' LIMIT 1");
      return rows[0]?.id ?? null;
    } catch (err) {
      throw fallaDeBase('Error consultando zonas', err);
    }
  }

  async create({ tenantId, clienteId, zonaId, direccion, reglas }) {
    try {
      const { rows } = await enContextoTenant(this.pgPoolFactory, tenantId, (client) =>
        client.query(
          `INSERT INTO sitio (tenant_id, cliente_id, zona_id, direccion, reglas)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING *`,
          [tenantId, clienteId, zonaId, direccion, reglas === undefined ? null : JSON.stringify(reglas)]
        )
      );
      return filaPlana(rows[0]);
    } catch (err) {
      throw fallaDeBase('Error creando sitio', err);
    }
  }

  async deleteByClienteId(tenantId, clienteId) {
    try {
      await enContextoTenant(this.pgPoolFactory, tenantId, (client) =>
        client.query('DELETE FROM sitio WHERE tenant_id = $1 AND cliente_id = $2', [tenantId, clienteId])
      );
    } catch (err) {
      throw fallaDeBase('Error eliminando sitio', err);
    }
  }
}

module.exports = PgSitioRepository;
