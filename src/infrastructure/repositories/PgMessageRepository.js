const IMessageRepository = require('../../domain/ports/IMessageRepository');
const { ConflictError, NotFoundError, ValidationError } = require('../../domain/errors/DomainError');
const { runInTenantContext } = require('../db/runInTenantContext');
const { solicitudVisible } = require('./sesionActores');
const { ROL_FROM_DB } = require('./supabaseEnumMaps');

const UNIQUE_VIOLATION = '23505';

// Con la solicitud ya asignada y hasta que el servicio termina o se cierra. Fuera de ellos el hilo se lee, no se escribe.
const ESTADOS_QUE_ADMITEN_MENSAJES = ['ASIGNADA', 'COTIZANDO', 'ACEPTADA', 'EN_EJECUCION'];

const COLUMNAS = 'm.id, m.solicitud_id, m.contenido, m.created_at, m.remitente_id, u.rol AS remitente_rol';

function toMessage(row, ctx) {
  return {
    id: row.id,
    solicitudId: row.solicitud_id,
    contenido: row.contenido,
    creadoEn: row.created_at,
    // Quién lo escribió, sin datos personales: el rol alcanza para pintar el hilo y `mio` para alinearlo.
    remitente: { rol: ROL_FROM_DB[row.remitente_rol] || row.remitente_rol },
    mio: row.remitente_id === ctx.userId,
  };
}

// Un hilo ajeno responde igual que uno inexistente: no se revela que la solicitud existe.
const noEncontrado = () => new NotFoundError('MANI-MSG-404: solicitud no encontrada', 'MANI-MSG-404');

async function porClave(client, ctx, solicitudId, clave) {
  const { rows } = await client.query(
    `SELECT ${COLUMNAS} FROM mensaje m JOIN usuario u ON u.id = m.remitente_id
     WHERE m.tenant_id = $1 AND m.solicitud_id = $2 AND m.remitente_id = $3 AND m.clave_idempotencia = $4`,
    [ctx.tenantId, solicitudId, ctx.userId, clave]
  );
  return rows.length ? toMessage(rows[0], ctx) : null;
}

/**
 * Mensajes del servicio sobre `pg`, dentro de transacciones con withTenantContext (ADR-0032). Toda consulta filtra por
 * el tenant del JWT además de RLS, y el hilo solo se abre si la sesión es el cliente dueño o el aliado asignado.
 */
class PgMessageRepository extends IMessageRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgMessageRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async enviar(ctx, datos) {
    try {
      return await runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
        const { estado } = await solicitudVisible(client, ctx, datos.solicitudId, noEncontrado);

        // Un reintento con la misma clave devuelve lo ya guardado, aunque el servicio haya avanzado después.
        if (datos.claveIdempotencia) {
          const previo = await porClave(client, ctx, datos.solicitudId, datos.claveIdempotencia);
          if (previo) return { mensaje: previo, creado: false };
        }

        if (!ESTADOS_QUE_ADMITEN_MENSAJES.includes(estado)) {
          throw new ConflictError(
            `MANI-MSG-409E: la solicitud en estado ${estado} no admite mensajes nuevos`,
            'MANI-MSG-409E'
          );
        }

        const { rows } = await client.query(
          `WITH nuevo AS (
             INSERT INTO mensaje (tenant_id, solicitud_id, remitente_id, contenido, clave_idempotencia)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, tenant_id, solicitud_id, remitente_id, contenido, created_at
           )
           SELECT m.id, m.solicitud_id, m.contenido, m.created_at, m.remitente_id, u.rol AS remitente_rol
           FROM nuevo m JOIN usuario u ON u.id = m.remitente_id`,
          [ctx.tenantId, datos.solicitudId, ctx.userId, datos.contenido, datos.claveIdempotencia]
        );
        return { mensaje: toMessage(rows[0], ctx), creado: true };
      });
    } catch (err) {
      if (err.code !== UNIQUE_VIOLATION || !datos.claveIdempotencia) throw err;
      // Dos envíos con la misma clave en paralelo: el índice único decide y el segundo devuelve el ganador.
      const previo = await runInTenantContext(this.pgPoolFactory, ctx, (client) =>
        porClave(client, ctx, datos.solicitudId, datos.claveIdempotencia)
      );
      if (previo) return { mensaje: previo, creado: false };
      throw err;
    }
  }

  async listar(ctx, datos) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      await solicitudVisible(client, ctx, datos.solicitudId, noEncontrado);

      if (datos.despuesDe) {
        // La comparación se hace en SQL: pasar created_at por JavaScript recorta los microsegundos y devolvería otra
        // vez el mensaje del cursor en cada consulta.
        const { rows } = await client.query(
          `SELECT ${COLUMNAS} FROM mensaje m JOIN usuario u ON u.id = m.remitente_id
           JOIN mensaje cursor ON cursor.id = $3 AND cursor.solicitud_id = m.solicitud_id AND cursor.tenant_id = m.tenant_id
           WHERE m.solicitud_id = $1 AND m.tenant_id = $2 AND (m.created_at, m.id) > (cursor.created_at, cursor.id)
           ORDER BY m.created_at, m.id
           LIMIT $4`,
          [datos.solicitudId, ctx.tenantId, datos.despuesDe, datos.limite]
        );
        if (rows.length === 0) {
          const existe = await client.query('SELECT 1 FROM mensaje WHERE id = $1 AND solicitud_id = $2 AND tenant_id = $3', [
            datos.despuesDe,
            datos.solicitudId,
            ctx.tenantId,
          ]);
          if (existe.rows.length === 0) {
            throw new ValidationError('MANI-MSG-400: despuesDe no es un mensaje de este hilo', 'MANI-MSG-400');
          }
        }
        return { mensajes: rows.map((r) => toMessage(r, ctx)) };
      }

      // Primera carga: los últimos mensajes, devueltos del más antiguo al más reciente.
      const { rows } = await client.query(
        `SELECT * FROM (
           SELECT ${COLUMNAS} FROM mensaje m JOIN usuario u ON u.id = m.remitente_id
           WHERE m.solicitud_id = $1 AND m.tenant_id = $2
           ORDER BY m.created_at DESC, m.id DESC
           LIMIT $3
         ) ultimos ORDER BY created_at, id`,
        [datos.solicitudId, ctx.tenantId, datos.limite]
      );
      return { mensajes: rows.map((r) => toMessage(r, ctx)) };
    });
  }
}

PgMessageRepository.ESTADOS_QUE_ADMITEN_MENSAJES = ESTADOS_QUE_ADMITEN_MENSAJES;
module.exports = PgMessageRepository;
