const ISolicitudContextRepository = require('../../domain/ports/ISolicitudContextRepository');
const requirePool = require('../db/requirePool');

class PgSolicitudContextRepository extends ISolicitudContextRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgSolicitudContextRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async findContext(tenantId, solicitudId) {
    const pool = requirePool(this.pgPoolFactory);
    const { rows } = await pool.query(
      'SELECT id, tenant_id, zona_id, categoria_id, estado FROM solicitud WHERE id = $1 AND tenant_id = $2',
      [solicitudId, tenantId]
    );
    if (rows.length === 0) return null;
    const row = rows[0];
    return { id: row.id, tenantId: row.tenant_id, zonaId: row.zona_id, categoriaId: row.categoria_id, estado: row.estado };
  }
}

module.exports = PgSolicitudContextRepository;
