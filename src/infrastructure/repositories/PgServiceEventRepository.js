const IServiceEventRepository = require('../../domain/ports/IServiceEventRepository');
const { ConflictError, ForbiddenError, NotFoundError } = require('../../domain/errors/DomainError');
const { runInTenantContext } = require('../db/runInTenantContext');
const { aliadoDeSesion, solicitudVisible } = require('./sesionActores');

const UNIQUE_VIOLATION = '23505';

const COLUMNAS = `e.id, e.tipo_evento, e.descripcion, e.timestamp, e.actor_id, u.rol AS actor_rol,
       (e.evidencia_ruta IS NOT NULL) AS tiene_evidencia`;

function toEvento(row) {
  return {
    id: row.id,
    tipo: row.tipo_evento,
    descripcion: row.descripcion,
    registradoEn: row.timestamp,
    // Auditoría del autor (C3): quién lo registró y con qué rol, sin datos personales.
    autor: { id: row.actor_id, rol: row.actor_rol },
    tieneEvidencia: row.tiene_evidencia,
  };
}

const noEncontrada = () => new NotFoundError('MANI-EVT-404: solicitud no encontrada', 'MANI-EVT-404');
const noAsignado = () =>
  new ForbiddenError('MANI-EVT-403A: solo el aliado asignado registra eventos del servicio', 'MANI-EVT-403A');

async function porClave(client, ctx, solicitudId, clave) {
  const { rows } = await client.query(
    `SELECT ${COLUMNAS} FROM evento_servicio e JOIN usuario u ON u.id = e.actor_id
     WHERE e.tenant_id = $1 AND e.solicitud_id = $2 AND e.clave_idempotencia = $3`,
    [ctx.tenantId, solicitudId, clave]
  );
  return rows.length ? toEvento(rows[0]) : null;
}

/** Eventos del servicio sobre `pg` con el contexto de tenant fijado (ADR-0032). */
class PgServiceEventRepository extends IServiceEventRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgServiceEventRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async registrar(ctx, datos) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const aliadoId = await aliadoDeSesion(client, ctx, noAsignado);

      // Se bloquea la solicitud para que un evento no entre a la vez que el aliado finaliza el servicio.
      const fila = await client.query(
        'SELECT estado, aliado_id FROM solicitud WHERE id = $1 AND tenant_id = $2 FOR UPDATE',
        [datos.solicitudId, ctx.tenantId]
      );
      if (fila.rows.length === 0) throw noEncontrada();
      if (fila.rows[0].aliado_id !== aliadoId) throw noAsignado();

      // Un reintento con la misma clave devuelve lo ya registrado, aunque el servicio haya terminado después.
      if (datos.claveIdempotencia) {
        const previo = await porClave(client, ctx, datos.solicitudId, datos.claveIdempotencia);
        if (previo) return { evento: previo, creado: false };
      }
      if (fila.rows[0].estado !== 'EN_EJECUCION') {
        throw new ConflictError(
          `MANI-EVT-409E: solo se registran eventos durante la ejecución (estado ${fila.rows[0].estado})`,
          'MANI-EVT-409E'
        );
      }

      await client.query('SAVEPOINT registrar_evento');
      try {
        const { rows } = await client.query(
          `WITH nuevo AS (
             INSERT INTO evento_servicio (tenant_id, solicitud_id, actor_id, tipo_evento, descripcion, evidencia_ruta, clave_idempotencia)
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING *
           )
           SELECT ${COLUMNAS} FROM nuevo e JOIN usuario u ON u.id = e.actor_id`,
          [
            ctx.tenantId,
            datos.solicitudId,
            ctx.userId,
            datos.tipo,
            datos.observacion,
            datos.evidenciaRuta,
            datos.claveIdempotencia,
          ]
        );
        return { evento: toEvento(rows[0]), creado: true };
      } catch (err) {
        if (err.code === UNIQUE_VIOLATION && datos.claveIdempotencia) {
          await client.query('ROLLBACK TO SAVEPOINT registrar_evento');
          return { evento: await porClave(client, ctx, datos.solicitudId, datos.claveIdempotencia), creado: false };
        }
        throw err;
      }
    });
  }

  async listar(ctx, solicitudId) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      await solicitudVisible(client, ctx, solicitudId, noEncontrada);

      const { rows } = await client.query(
        `SELECT ${COLUMNAS} FROM evento_servicio e JOIN usuario u ON u.id = e.actor_id
         WHERE e.solicitud_id = $1 AND e.tenant_id = $2
         ORDER BY e.timestamp, e.id`,
        [solicitudId, ctx.tenantId]
      );
      return rows.map(toEvento);
    });
  }
}

module.exports = PgServiceEventRepository;
