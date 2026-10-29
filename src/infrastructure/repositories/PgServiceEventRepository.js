const IServiceEventRepository = require('../../domain/ports/IServiceEventRepository');
const { ConflictError, ForbiddenError, NotFoundError, ValidationError } = require('../../domain/errors/DomainError');
const { runInTenantContext } = require('../db/runInTenantContext');
const { aliadoDeSesion, solicitudVisible } = require('./sesionActores');

const UNIQUE_VIOLATION = '23505';
// SCRUM-873: margen para el reloj del teléfono; un evento con hora de captura más adelante se rechaza.
const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;

// Los eventos previos a la 0026 no tienen hora de captura: se usa la de registro.
const COLUMNAS = `e.id, e.tipo_evento, e.descripcion, e.timestamp, COALESCE(e.ocurrido_en, e.timestamp) AS ocurrido_en,
       e.actor_id, u.rol AS actor_rol, (e.evidencia_ruta IS NOT NULL) AS tiene_evidencia`;

function toEvento(row) {
  return {
    id: row.id,
    tipo: row.tipo_evento,
    descripcion: row.descripcion,
    // SCRUM-873: la hora de captura es la oficial (se muestra y ordena); la de registro queda para auditoría.
    ocurridoEn: row.ocurrido_en,
    registradoEn: row.timestamp,
    // Auditoría del autor (C3): quién lo registró y con qué rol, sin datos personales.
    autor: { id: row.actor_id, rol: row.actor_rol },
    tieneEvidencia: row.tiene_evidencia,
  };
}

const fueraDeEstado = (estado) =>
  new ConflictError(
    `MANI-EVT-409E: solo se registran eventos durante la ejecución (estado ${estado})`,
    'MANI-EVT-409E'
  );
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

const fueraDeEjecucion = (detalle) =>
  new ConflictError(`MANI-EVT-409T: el evento se tomó ${detalle}`, 'MANI-EVT-409T');

/**
 * SCRUM-873 (decisión del PO, 10549): un evento con hora de captura entra aunque el servicio ya haya finalizado,
 * siempre que se haya tomado entre el inicio y el fin de la ejecución. Nunca en el futuro ni en un servicio cancelado.
 */
async function validarHoraDeCaptura(client, ctx, solicitudId, estado, ocurridoEn) {
  if (estado !== 'EN_EJECUCION' && estado !== 'FINALIZADA') throw fueraDeEstado(estado);
  const { rows } = await client.query(
    `SELECT now() AS ahora,
            max(timestamp) FILTER (WHERE tipo_evento = 'INICIO_EJECUCION') AS inicio,
            max(timestamp) FILTER (WHERE tipo_evento = 'FIN_EJECUCION') AS fin
     FROM evento_servicio WHERE solicitud_id = $1 AND tenant_id = $2`,
    [solicitudId, ctx.tenantId]
  );
  const { ahora, inicio, fin } = rows[0];
  if (ocurridoEn.getTime() > ahora.getTime() + TOLERANCIA_FUTURO_MS) {
    throw new ValidationError('MANI-EVT-400F: la hora de captura está en el futuro', 'MANI-EVT-400F');
  }
  if (!inicio || ocurridoEn < inicio) throw fueraDeEjecucion('antes del inicio de la ejecución');
  if (estado === 'FINALIZADA' && (!fin || ocurridoEn > fin)) throw fueraDeEjecucion('después del fin de la ejecución');
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
      const { estado } = fila.rows[0];
      if (datos.ocurridoEn) {
        await validarHoraDeCaptura(client, ctx, datos.solicitudId, estado, datos.ocurridoEn);
      } else if (estado !== 'EN_EJECUCION') {
        throw fueraDeEstado(estado);
      }

      await client.query('SAVEPOINT registrar_evento');
      try {
        const { rows } = await client.query(
          `WITH nuevo AS (
             INSERT INTO evento_servicio
               (tenant_id, solicitud_id, actor_id, tipo_evento, descripcion, evidencia_ruta, clave_idempotencia, ocurrido_en)
             VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, now()))
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
            datos.ocurridoEn || null,
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
         ORDER BY COALESCE(e.ocurrido_en, e.timestamp), e.timestamp, e.id`,
        [solicitudId, ctx.tenantId]
      );
      return rows.map(toEvento);
    });
  }

  async rutaEvidencia(ctx, solicitudId, eventoId) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      await solicitudVisible(client, ctx, solicitudId, noEncontrada);
      const { rows } = await client.query(
        'SELECT evidencia_ruta FROM evento_servicio WHERE id = $1 AND solicitud_id = $2 AND tenant_id = $3',
        [eventoId, solicitudId, ctx.tenantId]
      );
      if (rows.length === 0 || !rows[0].evidencia_ruta) {
        throw new NotFoundError('MANI-EVT-404E: el evento no tiene evidencia', 'MANI-EVT-404E');
      }
      return rows[0].evidencia_ruta;
    });
  }
}

module.exports = PgServiceEventRepository;
