const ISolicitudRepository = require('../../domain/ports/ISolicitudRepository');
const Solicitud = require('../../domain/entities/Solicitud');
const { runInTenantContext } = require('../db/runInTenantContext');

const COLUMNS = 'id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, aliado_id, descripcion, estado, created_at, updated_at';

function toEntity(row) {
  return new Solicitud({
    id: row.id,
    tenantId: row.tenant_id,
    clienteId: row.cliente_id,
    sitioId: row.sitio_id,
    categoriaId: row.categoria_id,
    zonaId: row.zona_id,
    aliadoId: row.aliado_id,
    descripcion: row.descripcion,
    estado: row.estado,
    fechaCreacion: row.created_at,
    fechaActualizacion: row.updated_at,
  });
}

/** Lectura y transición de estado de `solicitud` desde Core, con el contexto de tenant fijado (ADR-0032). */
class PgSolicitudRepository extends ISolicitudRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgSolicitudRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async findById(ctx, id) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(`SELECT ${COLUMNS} FROM solicitud WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId]);
      return rows.length ? toEntity(rows[0]) : null;
    });
  }

  async findByClienteId(ctx, clienteId, { estado = null } = {}) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT ${COLUMNS} FROM solicitud
         WHERE tenant_id = $1 AND cliente_id = $2 AND ($3::text IS NULL OR estado = $3::text)
         ORDER BY created_at DESC`,
        [ctx.tenantId, clienteId, estado]
      );
      return rows.map(toEntity);
    });
  }

  async updateEstado(ctx, id, estado) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `UPDATE solicitud SET estado = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3 RETURNING ${COLUMNS}`,
        [estado, id, ctx.tenantId]
      );
      return rows.length ? toEntity(rows[0]) : null;
    });
  }

  async transicionarEstado(ctx, id, desde, hacia) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `UPDATE solicitud SET estado = $1, updated_at = now()
         WHERE id = $2 AND tenant_id = $3 AND estado = ANY($4::text[])
         RETURNING ${COLUMNS}`,
        [hacia, id, ctx.tenantId, desde]
      );
      return rows.length ? toEntity(rows[0]) : null;
    });
  }
}

module.exports = PgSolicitudRepository;
