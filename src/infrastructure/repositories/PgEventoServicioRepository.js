const IEventoServicioRepository = require('../../domain/ports/IEventoServicioRepository');
const EventoServicio = require('../../domain/entities/EventoServicio');
const { runInTenantContext } = require('../db/runInTenantContext');
const { NotFoundError } = require('../../domain/errors/DomainError');

const COLUMNS = 'id, tenant_id, solicitud_id, actor_id, tipo_evento, descripcion, "timestamp"';

function toEntity(row) {
  return new EventoServicio({
    id: row.id,
    tenantId: row.tenant_id,
    solicitudId: row.solicitud_id,
    actorId: row.actor_id,
    tipoEvento: row.tipo_evento,
    descripcion: row.descripcion,
    fecha: row.timestamp,
  });
}

/** Tabla `evento_servicio` sobre `pg` con el contexto de tenant fijado (ADR-0030, ADR-0032). */
class PgEventoServicioRepository extends IEventoServicioRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgEventoServicioRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async create(ctx, evento) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        // Solo inserta si la solicitud es del mismo tenant (la FK no pasa por RLS).
        `INSERT INTO evento_servicio (tenant_id, solicitud_id, actor_id, tipo_evento, descripcion)
         SELECT $1, $2, $3, $4, $5
         WHERE EXISTS (SELECT 1 FROM solicitud s WHERE s.id = $2 AND s.tenant_id = $1)
         RETURNING ${COLUMNS}`,
        [ctx.tenantId, evento.solicitudId, evento.actorId, evento.tipoEvento, evento.descripcion]
      );
      if (rows.length === 0) throw new NotFoundError('Solicitud no encontrada');
      return toEntity(rows[0]);
    });
  }

  async findBySolicitudId(ctx, solicitudId) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT ${COLUMNS} FROM evento_servicio WHERE solicitud_id = $1 AND tenant_id = $2 ORDER BY "timestamp", id`,
        [solicitudId, ctx.tenantId]
      );
      return rows.map(toEntity);
    });
  }
}

module.exports = PgEventoServicioRepository;
