const IQuoteRepository = require('../../domain/ports/IQuoteRepository');
const { ConflictError, ForbiddenError, NotFoundError } = require('../../domain/errors/DomainError');
const { runInTenantContext } = require('../db/runInTenantContext');

// La solicitud admite cotización desde que Dispatch la asigna y mientras el cliente no la haya resuelto.
const ESTADOS_COTIZABLES = ['ASIGNADA', 'COTIZANDO'];

const COLUMNAS = 'id, solicitud_id, version, estado, valor_mano_obra, valor_materiales, created_at';

function toQuote(row) {
  const manoObra = Number(row.valor_mano_obra);
  const materiales = Number(row.valor_materiales);
  return {
    id: row.id,
    solicitudId: row.solicitud_id,
    version: row.version,
    estado: row.estado,
    valorManoObra: manoObra,
    valorMateriales: materiales,
    // Mismo redondeo que la validación: los importes llegan con dos decimales como máximo.
    total: Math.round((manoObra + materiales) * 100) / 100,
    creadaEn: row.created_at,
  };
}

const noEncontrada = () => new NotFoundError('MANI-COT-404: solicitud no encontrada', 'MANI-COT-404');
const noAsignado = () =>
  new ForbiddenError('MANI-COT-403A: solo el aliado asignado a la solicitud puede cotizarla', 'MANI-COT-403A');

/**
 * Cotización sobre `pg` dentro de una transacción con withTenantContext (ADR-0032). Toda consulta filtra por
 * el tenant del JWT además de RLS. La fila de la solicitud se bloquea (FOR UPDATE) para que dos envíos
 * simultáneos no dupliquen la versión ni dejen dos cotizaciones pendientes.
 */
class PgQuoteRepository extends IQuoteRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgQuoteRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async emitir(ctx, datos) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const aliado = await client.query('SELECT id FROM aliado WHERE usuario_id = $1 AND tenant_id = $2', [
        ctx.userId,
        ctx.tenantId,
      ]);
      if (aliado.rows.length === 0) throw noAsignado();
      const aliadoId = aliado.rows[0].id;

      const solicitud = await client.query(
        'SELECT estado, aliado_id FROM solicitud WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [datos.solicitudId, ctx.tenantId]
      );
      if (solicitud.rows.length === 0) throw noEncontrada();
      const { estado, aliado_id: asignado } = solicitud.rows[0];
      if (asignado !== aliadoId) throw noAsignado();
      if (!ESTADOS_COTIZABLES.includes(estado)) {
        throw new ConflictError(`MANI-COT-409E: la solicitud en estado ${estado} no admite cotización`, 'MANI-COT-409E');
      }

      const previas = await client.query(
        `SELECT coalesce(max(version), 0)::int AS ultima, count(*) FILTER (WHERE estado = 'PENDIENTE')::int AS pendientes
         FROM cotizacion WHERE solicitud_id = $1 AND tenant_id = $2`,
        [datos.solicitudId, ctx.tenantId]
      );
      const { ultima, pendientes } = previas.rows[0];
      if (pendientes > 0) {
        throw new ConflictError(
          'MANI-COT-409P: la solicitud ya tiene una cotización pendiente de respuesta del cliente',
          'MANI-COT-409P'
        );
      }

      const creada = await client.query(
        `INSERT INTO cotizacion (tenant_id, solicitud_id, aliado_id, valor_mano_obra, valor_materiales, estado, version)
         VALUES ($1, $2, $3, $4, $5, 'PENDIENTE', $6)
         RETURNING ${COLUMNAS}`,
        [ctx.tenantId, datos.solicitudId, aliadoId, datos.valorManoObra, datos.valorMateriales, ultima + 1]
      );
      const cotizacion = toQuote(creada.rows[0]);

      await client.query(
        "UPDATE solicitud SET estado = 'COTIZANDO', updated_at = now() WHERE id = $1 AND tenant_id = $2",
        [datos.solicitudId, ctx.tenantId]
      );
      // QS-12: la cotización queda en la línea de tiempo del servicio.
      await client.query(
        `INSERT INTO evento_servicio (tenant_id, solicitud_id, actor_id, tipo_evento, descripcion)
         VALUES ($1, $2, $3, 'COTIZACION_ENVIADA', $4)`,
        [
          ctx.tenantId,
          datos.solicitudId,
          ctx.userId,
          `Cotización v${cotizacion.version}: mano de obra ${cotizacion.valorManoObra}, materiales ${cotizacion.valorMateriales}, total ${cotizacion.total}`,
        ]
      );

      return cotizacion;
    });
  }

  async listarPorSolicitud(ctx, solicitudId) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      // Solo el cliente dueño o el aliado asignado. Para cualquier otro la solicitud no existe: así no se
      // revela que hay una solicitud ajena con ese id.
      const acceso = await client.query(
        `SELECT 1
         FROM solicitud s
         LEFT JOIN cliente c ON c.id = s.cliente_id AND c.tenant_id = s.tenant_id
         LEFT JOIN aliado a ON a.id = s.aliado_id AND a.tenant_id = s.tenant_id
         WHERE s.id = $1 AND s.tenant_id = $2
           AND (($3 = 'CLIENT' AND c.usuario_id = $4) OR ($3 = 'ALLY' AND a.usuario_id = $4))`,
        [solicitudId, ctx.tenantId, ctx.role, ctx.userId]
      );
      if (acceso.rows.length === 0) throw noEncontrada();

      const { rows } = await client.query(
        `SELECT ${COLUMNAS} FROM cotizacion
         WHERE solicitud_id = $1 AND tenant_id = $2
         ORDER BY version DESC`,
        [solicitudId, ctx.tenantId]
      );
      return rows.map(toQuote);
    });
  }
}

module.exports = PgQuoteRepository;
