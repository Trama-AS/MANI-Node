const ICotizacionRepository = require('../../domain/ports/ICotizacionRepository');
const Cotizacion = require('../../domain/entities/Cotizacion');
const { runInTenantContext } = require('../db/runInTenantContext');
const { NotFoundError } = require('../../domain/errors/DomainError');

const COLUMNS = 'id, tenant_id, solicitud_id, aliado_id, valor_mano_obra, valor_materiales, estado, version, observacion, created_at';

function toEntity(row) {
  return new Cotizacion({
    id: row.id,
    tenantId: row.tenant_id,
    solicitudId: row.solicitud_id,
    aliadoId: row.aliado_id,
    valorManoObra: row.valor_mano_obra,
    valorMateriales: row.valor_materiales,
    estado: row.estado,
    version: row.version,
    observacion: row.observacion,
    fechaCreacion: row.created_at,
  });
}

/** Tabla `cotizacion` sobre `pg` con el contexto de tenant fijado (ADR-0030, ADR-0032). */
class PgCotizacionRepository extends ICotizacionRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgCotizacionRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async create(ctx, cotizacion) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        // Solo inserta si la solicitud es del mismo tenant: la FK no pasa por RLS y, sin esta condición,
        // una cotización de un tenant podría apuntar a la solicitud de otro.
        `INSERT INTO cotizacion (tenant_id, solicitud_id, aliado_id, valor_mano_obra, valor_materiales, estado, version, observacion)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8
         WHERE EXISTS (SELECT 1 FROM solicitud s WHERE s.id = $2 AND s.tenant_id = $1)
         RETURNING ${COLUMNS}`,
        [
          ctx.tenantId,
          cotizacion.solicitudId,
          cotizacion.aliadoId,
          cotizacion.valorManoObra,
          cotizacion.valorMateriales,
          cotizacion.estado,
          cotizacion.version,
          cotizacion.observacion,
        ]
      );
      if (rows.length === 0) throw new NotFoundError('Solicitud no encontrada');
      return toEntity(rows[0]);
    });
  }

  async findById(ctx, id) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(`SELECT ${COLUMNS} FROM cotizacion WHERE id = $1 AND tenant_id = $2`, [id, ctx.tenantId]);
      return rows.length ? toEntity(rows[0]) : null;
    });
  }

  async findBySolicitudId(ctx, solicitudId) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT ${COLUMNS} FROM cotizacion WHERE solicitud_id = $1 AND tenant_id = $2 ORDER BY version, created_at`,
        [solicitudId, ctx.tenantId]
      );
      return rows.map(toEntity);
    });
  }

  async updateEstado(ctx, id, estado, { soloSiEstado = null } = {}) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `UPDATE cotizacion SET estado = $1
         WHERE id = $2 AND tenant_id = $3 AND ($4::text IS NULL OR estado = $4::text)
         RETURNING ${COLUMNS}`,
        [estado, id, ctx.tenantId, soloSiEstado]
      );
      return rows.length ? toEntity(rows[0]) : null;
    });
  }
}

module.exports = PgCotizacionRepository;
