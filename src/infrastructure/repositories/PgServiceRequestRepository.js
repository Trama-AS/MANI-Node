const IServiceRequestRepository = require('../../domain/ports/IServiceRequestRepository');
const { DomainError, ForbiddenError, NotFoundError, ConflictError } = require('../../domain/errors/DomainError');
const { runInTenantContext } = require('../db/runInTenantContext');

const UNIQUE_VIOLATION = '23505';

const PROYECCION_SQL = `
  SELECT s.id, s.estado, s.categoria_id, c.nombre AS categoria, c.flujo_operativo, s.descripcion,
         s.sitio_id, si.direccion, s.zona_id, z.nombre AS zona, zp.nombre AS zona_padre,
         (SELECT count(*)::int FROM solicitud_foto f WHERE f.solicitud_id = s.id) AS fotos, s.created_at
  FROM solicitud s
  JOIN categoria_servicio c ON c.id = s.categoria_id
  JOIN sitio si ON si.id = s.sitio_id
  JOIN zona z ON z.id = s.zona_id
  LEFT JOIN zona zp ON zp.id = z.zona_padre_id
  WHERE s.id = $1 AND s.tenant_id = $2`;

// Seguimiento del cliente (SCRUM-871): solo sus solicitudes, por el usuario del JWT y el tenant.
const SEGUIMIENTO_SQL = `
  SELECT s.id, s.estado, c.nombre AS categoria, z.nombre AS zona, z.nivel AS zona_nivel, zp.nombre AS zona_padre,
         s.created_at, s.updated_at
  FROM solicitud s
  JOIN cliente cl ON cl.id = s.cliente_id AND cl.tenant_id = s.tenant_id
  JOIN categoria_servicio c ON c.id = s.categoria_id
  JOIN zona z ON z.id = s.zona_id
  LEFT JOIN zona zp ON zp.id = z.zona_padre_id
  WHERE cl.usuario_id = $1 AND s.tenant_id = $2`;
const MAX_SEGUIMIENTO = 50;

// Cancelación (SCRUM-877): se cancela cualquier estado anterior a la ejecución.
const ESTADOS_CANCELABLES = ['PENDIENTE', 'ASIGNADA', 'COTIZANDO', 'ACEPTADA', 'RECHAZADA'];
const MOTIVO_CANCELACION = 'El cliente canceló la solicitud.';

function seguimiento(r) {
  return {
    id: r.id,
    estado: r.estado,
    categoria: r.categoria,
    // Zona declarada al publicar la solicitud; nunca la posición del aliado.
    zonaDeclarada: { nombre: r.zona, nivel: r.zona_nivel, zonaPadre: r.zona_padre },
    creadaEn: r.created_at,
    actualizadaEn: r.updated_at,
  };
}

function rechazo(codigo, mensaje) {
  return new DomainError(`${codigo}: ${mensaje}`, codigo, 422);
}

async function proyeccion(client, tenantId, id) {
  const { rows } = await client.query(PROYECCION_SQL, [id, tenantId]);
  const r = rows[0];
  return {
    id: r.id,
    estado: r.estado,
    categoriaId: r.categoria_id,
    categoria: r.categoria,
    flujoOperativo: r.flujo_operativo,
    descripcion: r.descripcion,
    sitioId: r.sitio_id,
    direccion: r.direccion,
    zonaId: r.zona_id,
    zona: r.zona,
    zonaPadre: r.zona_padre,
    fotos: r.fotos,
    createdAt: r.created_at,
  };
}

async function existentePorClave(client, ctx, clienteId, clave) {
  if (!clave) return null;
  const { rows } = await client.query(
    'SELECT id FROM solicitud WHERE cliente_id = $1 AND clave_idempotencia = $2 AND tenant_id = $3',
    [clienteId, clave, ctx.tenantId]
  );
  return rows.length ? rows[0].id : null;
}

/**
 * Creación de solicitud sobre `pg` dentro de una transacción con withTenantContext (ADR-0032).
 * Mismas reglas y códigos que `crear_solicitud` (006): cliente activo, idempotencia por clave, categoría ACTIVO
 * del tenant, sitio propio o dirección nueva en zona activa, fotos en `solicitud_foto` y evento SOLICITUD_CREADA.
 */
class PgServiceRequestRepository extends IServiceRequestRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgServiceRequestRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async crear(ctx, datos) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const cliente = await client.query(
        `SELECT c.id FROM cliente c JOIN usuario u ON u.id = c.usuario_id
         WHERE c.usuario_id = $1 AND c.tenant_id = $2 AND u.estado = 'ACTIVO'`,
        [ctx.userId, ctx.tenantId]
      );
      if (cliente.rows.length === 0) {
        throw new ForbiddenError('MANI-SOL-403C: solo un cliente activo puede publicar solicitudes', 'MANI-SOL-403C');
      }
      const clienteId = cliente.rows[0].id;

      const previa = await existentePorClave(client, ctx, clienteId, datos.claveIdempotencia);
      if (previa) {
        return { solicitud: await proyeccion(client, ctx.tenantId, previa), creada: false };
      }

      const categoria = await client.query(
        "SELECT 1 FROM categoria_servicio WHERE id = $1 AND tenant_id = $2 AND estado = 'ACTIVO'",
        [datos.categoriaId, ctx.tenantId]
      );
      if (categoria.rows.length === 0) throw rechazo('MANI-SOL-422C', 'categoría no disponible');

      let sitioId = null;
      let zonaId = datos.zonaId;
      if (datos.sitioId) {
        const sitio = await client.query(
          'SELECT id, zona_id FROM sitio WHERE id = $1 AND cliente_id = $2 AND tenant_id = $3',
          [datos.sitioId, clienteId, ctx.tenantId]
        );
        if (sitio.rows.length === 0) throw rechazo('MANI-SOL-422S', 'el sitio no existe');
        sitioId = sitio.rows[0].id;
        zonaId = sitio.rows[0].zona_id;
      } else {
        const zona = await client.query(
          "SELECT 1 FROM zona WHERE id = $1 AND upper(btrim(coalesce(estado, ''))) IN ('ACTIVO', 'ACTIVA')",
          [datos.zonaId]
        );
        if (zona.rows.length === 0) throw rechazo('MANI-SOL-422Z', 'zona no disponible');
      }

      // El sitio nuevo y la solicitud van juntos: si otro envío con la misma clave gana la carrera,
      // se deshacen ambos y se devuelve la solicitud ganadora (sin sitios huérfanos).
      await client.query('SAVEPOINT crear_solicitud');
      let solicitudId;
      try {
        if (!sitioId) {
          const nuevo = await client.query(
            `INSERT INTO sitio (tenant_id, cliente_id, zona_id, direccion, reglas)
             VALUES ($1, $2, $3, $4, '{}'::jsonb) RETURNING id`,
            [ctx.tenantId, clienteId, zonaId, datos.direccion]
          );
          sitioId = nuevo.rows[0].id;
        }
        const creada = await client.query(
          `INSERT INTO solicitud (tenant_id, cliente_id, sitio_id, categoria_id, zona_id, estado, descripcion, clave_idempotencia)
           VALUES ($1, $2, $3, $4, $5, 'PENDIENTE', $6, $7) RETURNING id`,
          [ctx.tenantId, clienteId, sitioId, datos.categoriaId, zonaId, datos.descripcion, datos.claveIdempotencia || null]
        );
        solicitudId = creada.rows[0].id;
      } catch (err) {
        if (err.code === UNIQUE_VIOLATION && datos.claveIdempotencia) {
          await client.query('ROLLBACK TO SAVEPOINT crear_solicitud');
          const ganadora = await existentePorClave(client, ctx, clienteId, datos.claveIdempotencia);
          return { solicitud: await proyeccion(client, ctx.tenantId, ganadora), creada: false };
        }
        throw err;
      }

      for (let i = 0; i < datos.fotos.length; i += 1) {
        await client.query(
          'INSERT INTO solicitud_foto (tenant_id, solicitud_id, ruta_storage, orden) VALUES ($1, $2, $3, $4)',
          [ctx.tenantId, solicitudId, datos.fotos[i], i + 1]
        );
      }

      // QS-12: la creación abre la línea de tiempo del servicio.
      await client.query(
        `INSERT INTO evento_servicio (tenant_id, solicitud_id, actor_id, tipo_evento, descripcion)
         VALUES ($1, $2, $3, 'SOLICITUD_CREADA', $4)`,
        [ctx.tenantId, solicitudId, ctx.userId, datos.descripcion.slice(0, 200)]
      );

      return { solicitud: await proyeccion(client, ctx.tenantId, solicitudId), creada: true };
    });
  }

  async listarDelCliente(ctx) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(`${SEGUIMIENTO_SQL} ORDER BY s.updated_at DESC, s.id LIMIT ${MAX_SEGUIMIENTO}`, [
        ctx.userId,
        ctx.tenantId,
      ]);
      return rows.map(seguimiento);
    });
  }

  async obtenerDelCliente(ctx, id) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(`${SEGUIMIENTO_SQL} AND s.id = $3`, [ctx.userId, ctx.tenantId, id]);
      return rows.length ? seguimiento(rows[0]) : null;
    });
  }

  /**
   * Cancela la solicitud propia del cliente antes de la ejecución (US-04.5.1 / SCRUM-877). La fila se bloquea
   * con FOR UPDATE, así que una aceptación o un inicio de ejecución concurrentes esperan y luego encuentran la
   * solicitud ya cancelada. Una ajena o de otro tenant es indistinguible de una inexistente (404).
   * Repetir la cancelación no repite el evento ni la notificación (`cancelada` false).
   */
  async cancelar(ctx, { solicitudId, motivo }) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const actual = await client.query(
        `SELECT s.estado, s.aliado_id
         FROM solicitud s
         JOIN cliente cl ON cl.id = s.cliente_id AND cl.tenant_id = s.tenant_id
         WHERE cl.usuario_id = $1 AND s.tenant_id = $2 AND s.id = $3
         FOR UPDATE OF s`,
        [ctx.userId, ctx.tenantId, solicitudId]
      );
      if (actual.rows.length === 0) throw new NotFoundError('MANI-SOL-404: solicitud no encontrada', 'MANI-SOL-404');
      const { estado, aliado_id: aliadoId } = actual.rows[0];

      if (estado !== 'CANCELADA') {
        if (!ESTADOS_CANCELABLES.includes(estado)) {
          throw new ConflictError(`MANI-SOL-409C: una solicitud ${estado} ya no se puede cancelar`, 'MANI-SOL-409C');
        }

        await client.query("UPDATE solicitud SET estado = 'CANCELADA', updated_at = now() WHERE id = $1 AND tenant_id = $2", [
          solicitudId,
          ctx.tenantId,
        ]);

        // QS-12: la cancelación queda en la línea de tiempo del servicio con el motivo del cliente.
        await client.query(
          `INSERT INTO evento_servicio (tenant_id, solicitud_id, actor_id, tipo_evento, descripcion)
           VALUES ($1, $2, $3, 'SOLICITUD_CANCELADA', $4)`,
          [ctx.tenantId, solicitudId, ctx.userId, motivo || MOTIVO_CANCELACION]
        );

        // El aliado asignado se entera en su bandeja, igual que con SOLICITUD_ASIGNADA (migración 005).
        if (aliadoId) {
          await client.query(
            `INSERT INTO notificacion (tenant_id, usuario_id, tipo, canal, payload)
             SELECT $1, a.usuario_id, 'SOLICITUD_CANCELADA', 'IN_APP', $3::jsonb
             FROM aliado a WHERE a.id = $2 AND a.tenant_id = $1`,
            [ctx.tenantId, aliadoId, JSON.stringify({ requestId: solicitudId })]
          );
        }
      }

      const { rows } = await client.query(`${SEGUIMIENTO_SQL} AND s.id = $3`, [ctx.userId, ctx.tenantId, solicitudId]);
      return { solicitud: seguimiento(rows[0]), cancelada: estado !== 'CANCELADA' };
    });
  }
}

module.exports = PgServiceRequestRepository;
