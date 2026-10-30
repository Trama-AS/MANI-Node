const IComplaintRepository = require('../../domain/ports/IComplaintRepository');
const { ConflictError, ForbiddenError, NotFoundError } = require('../../domain/errors/DomainError');
const { runInTenantContext } = require('../db/runInTenantContext');
const { clienteActivoDeSesion } = require('./sesionActores');

const COLUMNAS = `q.id, q.solicitud_id, q.motivo, q.descripcion, q.estado, q.respuesta, q.created_at, q.updated_at,
  cat.nombre AS categoria_nombre, s.estado AS estado_solicitud, u.email AS cliente_email`;

const DESDE = `FROM queja q
  JOIN solicitud s ON s.id = q.solicitud_id AND s.tenant_id = q.tenant_id
  JOIN categoria_servicio cat ON cat.id = s.categoria_id AND cat.tenant_id = s.tenant_id
  JOIN cliente cl ON cl.id = q.cliente_id AND cl.tenant_id = q.tenant_id
  JOIN usuario u ON u.id = cl.usuario_id`;

function toQueja(row) {
  return {
    id: row.id,
    solicitudId: row.solicitud_id,
    categoria: row.categoria_nombre,
    estadoSolicitud: row.estado_solicitud,
    motivo: row.motivo,
    descripcion: row.descripcion,
    estado: row.estado,
    respuesta: row.respuesta,
    cliente: { email: row.cliente_email },
    creadaEn: row.created_at,
    actualizadaEn: row.updated_at,
  };
}

function toTransicion(row) {
  return {
    estadoAnterior: row.estado_anterior,
    estadoNuevo: row.estado_nuevo,
    actor: { id: row.actor_id, rol: row.actor_rol },
    nota: row.nota,
    correlationId: row.correlation_id,
    fecha: row.created_at,
  };
}

const solicitudNoEncontrada = () => new NotFoundError('MANI-QJA-404S: solicitud no encontrada', 'MANI-QJA-404S');
const quejaNoEncontrada = () => new NotFoundError('MANI-QJA-404: queja no encontrada', 'MANI-QJA-404');

/**
 * Quejas sobre `pg` con withTenantContext (ADR-0032). Además del filtro explícito por tenant, la migración 0030 limita
 * por RLS al cliente a sus quejas y el cambio de estado a admin_tenant, y rechaza en el motor una transición inválida.
 */
class PgComplaintRepository extends IComplaintRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgComplaintRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async registrar(ctx, datos) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const clienteId = await clienteActivoDeSesion(
        client,
        ctx,
        () => new ForbiddenError('MANI-QJA-403C: solo un cliente activo presenta quejas', 'MANI-QJA-403C')
      );
      // Una solicitud de otro cliente responde igual que una inexistente: no se revela que existe (C2).
      const solicitud = await client.query(
        'SELECT aliado_id FROM solicitud WHERE id = $1 AND tenant_id = $2 AND cliente_id = $3 FOR UPDATE',
        [datos.solicitudId, ctx.tenantId, clienteId]
      );
      if (solicitud.rows.length === 0) throw solicitudNoEncontrada();
      if (!solicitud.rows[0].aliado_id) {
        throw new ConflictError(
          'MANI-QJA-409S: la solicitud aún no tiene un servicio asignado sobre el cual presentar una queja',
          'MANI-QJA-409S'
        );
      }

      let creada;
      try {
        creada = await client.query(
          `INSERT INTO queja (tenant_id, solicitud_id, cliente_id, motivo, descripcion, creado_por, correlation_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [ctx.tenantId, datos.solicitudId, clienteId, datos.motivo, datos.descripcion, ctx.userId, datos.correlationId]
        );
      } catch (err) {
        if (err.code === '23505' && err.constraint === 'ux_queja_abierta_por_solicitud') {
          throw new ConflictError('MANI-QJA-409A: la solicitud ya tiene una queja abierta', 'MANI-QJA-409A');
        }
        throw err;
      }
      const quejaId = creada.rows[0].id;
      await client.query(
        `INSERT INTO queja_transicion (tenant_id, queja_id, estado_anterior, estado_nuevo, actor_id, actor_rol, correlation_id)
         VALUES ($1, $2, NULL, 'ABIERTA', $3, $4, $5)`,
        [ctx.tenantId, quejaId, ctx.userId, ctx.role, datos.correlationId]
      );
      return this._detalle(client, ctx, quejaId);
    });
  }

  async listar(ctx, { estado, limite }) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT ${COLUMNAS} ${DESDE}
         WHERE q.tenant_id = $1 AND ($2::text IS NULL OR q.estado = $2)
           AND ($3 = 'ADMIN' OR cl.usuario_id = $4)
         ORDER BY q.created_at DESC, q.id
         LIMIT $5`,
        [ctx.tenantId, estado, ctx.role, ctx.userId, limite]
      );
      return rows.map(toQueja);
    });
  }

  async detalle(ctx, { quejaId }) {
    return runInTenantContext(this.pgPoolFactory, ctx, (client) => this._detalle(client, ctx, quejaId));
  }

  async cambiarEstado(ctx, datos) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const actual = await client.query(
        `SELECT q.estado, cl.usuario_id AS cliente_usuario_id, q.solicitud_id
         FROM queja q JOIN cliente cl ON cl.id = q.cliente_id AND cl.tenant_id = q.tenant_id
         WHERE q.id = $1 AND q.tenant_id = $2 FOR UPDATE OF q`,
        [datos.quejaId, ctx.tenantId]
      );
      if (actual.rows.length === 0) throw quejaNoEncontrada();
      const anterior = actual.rows[0].estado;
      // C2 de SCRUM-896: una transición inválida no toca la fila ni deja registro.
      if (!(datos.transicionesValidas[anterior] || []).includes(datos.estado)) {
        throw new ConflictError(
          `MANI-QJA-409T: una queja en estado ${anterior} no puede pasar a ${datos.estado}`,
          'MANI-QJA-409T'
        );
      }

      await client.query(
        `UPDATE queja SET estado = $1, respuesta = CASE WHEN $1 IN ('RESUELTA', 'RECHAZADA') THEN $2 ELSE respuesta END,
           updated_at = now()
         WHERE id = $3 AND tenant_id = $4`,
        [datos.estado, datos.nota, datos.quejaId, ctx.tenantId]
      );
      await client.query(
        `INSERT INTO queja_transicion (tenant_id, queja_id, estado_anterior, estado_nuevo, actor_id, actor_rol, nota, correlation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [ctx.tenantId, datos.quejaId, anterior, datos.estado, ctx.userId, ctx.role, datos.nota, datos.correlationId]
      );
      // El cliente se entera en su bandeja (/profiles/me/inbox).
      await client.query(
        `INSERT INTO notificacion (tenant_id, usuario_id, tipo, canal, payload)
         VALUES ($1, $2, 'QUEJA_ACTUALIZADA', 'PUSH', $3::jsonb)`,
        [
          ctx.tenantId,
          actual.rows[0].cliente_usuario_id,
          JSON.stringify({ quejaId: datos.quejaId, requestId: actual.rows[0].solicitud_id, estado: datos.estado }),
        ]
      );
      return this._detalle(client, ctx, datos.quejaId);
    });
  }

  async _detalle(client, ctx, quejaId) {
    const { rows } = await client.query(
      `SELECT ${COLUMNAS} ${DESDE}
       WHERE q.id = $1 AND q.tenant_id = $2 AND ($3 = 'ADMIN' OR cl.usuario_id = $4)`,
      [quejaId, ctx.tenantId, ctx.role, ctx.userId]
    );
    if (rows.length === 0) throw quejaNoEncontrada();
    const historial = await client.query(
      `SELECT estado_anterior, estado_nuevo, actor_id, actor_rol, nota, correlation_id, created_at
       FROM queja_transicion WHERE queja_id = $1 AND tenant_id = $2 ORDER BY created_at, id`,
      [quejaId, ctx.tenantId]
    );
    return { ...toQueja(rows[0]), historial: historial.rows.map(toTransicion) };
  }
}

module.exports = PgComplaintRepository;
