const IServiceExecutionRepository = require('../../domain/ports/IServiceExecutionRepository');
const { ConflictError, ForbiddenError, NotFoundError } = require('../../domain/errors/DomainError');
const { runInTenantContext } = require('../db/runInTenantContext');

const EVENTO = { INICIO: 'INICIO_EJECUCION', FIN: 'FIN_EJECUCION' };
const AVISO = { INICIO: 'EJECUCION_INICIADA', FIN: 'EJECUCION_FINALIZADA' };

const noEncontrada = () => new NotFoundError('MANI-EJE-404: solicitud no encontrada', 'MANI-EJE-404');
const noAsignado = () =>
  new ForbiddenError('MANI-EJE-403A: solo el aliado asignado marca el inicio y el fin del servicio', 'MANI-EJE-403A');
const conflicto = (codigo, mensaje) => new ConflictError(`${codigo}: ${mensaje}`, codigo);

/**
 * Estado al que pasa la solicitud, o el conflicto que impide la transición (C2).
 * Se inicia con la cotización aceptada; una categoría TARIFA_ESTANDAR no pasa por cotización (003, RF-22), así
 * que se inicia desde la asignación. Solo se finaliza lo que está en ejecución.
 */
function transicion(hito, estado, flujo) {
  if (hito === 'INICIO') {
    if (estado === 'ACEPTADA' || (estado === 'ASIGNADA' && flujo === 'TARIFA_ESTANDAR')) return 'EN_EJECUCION';
    if (estado === 'EN_EJECUCION') throw conflicto('MANI-EJE-409I', 'la ejecución ya fue iniciada');
    if (estado === 'FINALIZADA') throw conflicto('MANI-EJE-409F', 'el servicio ya fue finalizado');
    throw conflicto(
      'MANI-EJE-409E',
      `la solicitud en estado ${estado} no puede iniciarse; necesita la cotización aceptada`
    );
  }
  if (estado === 'EN_EJECUCION') return 'FINALIZADA';
  if (estado === 'FINALIZADA') throw conflicto('MANI-EJE-409F', 'el servicio ya fue finalizado');
  throw conflicto('MANI-EJE-409N', 'no se puede finalizar un servicio que no ha iniciado');
}

const marca = (fila) => (fila ? { registradoEn: fila.timestamp, observacion: fila.descripcion } : null);

/** Ejecución del servicio sobre `pg` con el contexto de tenant fijado (ADR-0032). */
class PgServiceExecutionRepository extends IServiceExecutionRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgServiceExecutionRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async marcar(ctx, datos) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const aliado = await client.query('SELECT id FROM aliado WHERE usuario_id = $1 AND tenant_id = $2', [
        ctx.userId,
        ctx.tenantId,
      ]);
      if (aliado.rows.length === 0) throw noAsignado();

      // La fila se bloquea: dos marcas simultáneas no producen dos transiciones.
      const fila = await client.query(
        `SELECT s.estado, s.aliado_id, cl.usuario_id AS cliente_usuario_id, c.flujo_operativo
         FROM solicitud s
         JOIN categoria_servicio c ON c.id = s.categoria_id AND c.tenant_id = s.tenant_id
         JOIN cliente cl ON cl.id = s.cliente_id AND cl.tenant_id = s.tenant_id
         WHERE s.id = $1 AND s.tenant_id = $2
         FOR UPDATE OF s`,
        [datos.solicitudId, ctx.tenantId]
      );
      if (fila.rows.length === 0) throw noEncontrada();
      const actual = fila.rows[0];
      if (actual.aliado_id !== aliado.rows[0].id) throw noAsignado();

      const nuevo = transicion(datos.hito, actual.estado, actual.flujo_operativo);

      await client.query('UPDATE solicitud SET estado = $1, updated_at = now() WHERE id = $2 AND tenant_id = $3', [
        nuevo,
        datos.solicitudId,
        ctx.tenantId,
      ]);
      // La hora es la del servidor de base de datos (CONS-24), nunca la que envíe la app.
      const evento = await client.query(
        `INSERT INTO evento_servicio (tenant_id, solicitud_id, actor_id, tipo_evento, descripcion)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING timestamp`,
        [ctx.tenantId, datos.solicitudId, ctx.userId, EVENTO[datos.hito], datos.observacion || null]
      );
      const registradoEn = evento.rows[0].timestamp;
      await client.query(
        `INSERT INTO notificacion (tenant_id, usuario_id, tipo, canal, payload)
         VALUES ($1, $2, $3, 'PUSH', $4::jsonb)`,
        [
          ctx.tenantId,
          actual.cliente_usuario_id,
          AVISO[datos.hito],
          JSON.stringify({ requestId: datos.solicitudId, registradoEn }),
        ]
      );

      return {
        solicitud: { id: datos.solicitudId, estado: nuevo },
        evento: { tipo: EVENTO[datos.hito], registradoEn },
      };
    });
  }

  async consultar(ctx, solicitudId) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      // Solo el cliente dueño o el aliado asignado; para cualquier otro la solicitud no existe.
      const acceso = await client.query(
        `SELECT s.estado
         FROM solicitud s
         LEFT JOIN cliente c ON c.id = s.cliente_id AND c.tenant_id = s.tenant_id
         LEFT JOIN aliado a ON a.id = s.aliado_id AND a.tenant_id = s.tenant_id
         WHERE s.id = $1 AND s.tenant_id = $2
           AND (($3 = 'CLIENT' AND c.usuario_id = $4) OR ($3 = 'ALLY' AND a.usuario_id = $4))`,
        [solicitudId, ctx.tenantId, ctx.role, ctx.userId]
      );
      if (acceso.rows.length === 0) throw noEncontrada();

      const { rows } = await client.query(
        `SELECT DISTINCT ON (tipo_evento) tipo_evento, timestamp, descripcion
         FROM evento_servicio
         WHERE solicitud_id = $1 AND tenant_id = $2 AND tipo_evento IN ('INICIO_EJECUCION', 'FIN_EJECUCION')
         ORDER BY tipo_evento, timestamp DESC`,
        [solicitudId, ctx.tenantId]
      );
      const porTipo = Object.fromEntries(rows.map((r) => [r.tipo_evento, r]));
      return {
        solicitudId,
        estado: acceso.rows[0].estado,
        inicio: marca(porTipo.INICIO_EJECUCION),
        fin: marca(porTipo.FIN_EJECUCION),
      };
    });
  }
}

module.exports = PgServiceExecutionRepository;
