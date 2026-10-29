const INotificacionRepository = require('../../domain/ports/INotificacionRepository');
const { runInTenantContext } = require('../db/runInTenantContext');

// Todas las operaciones corren dentro de runInTenantContext (ADR-0032): con mani_core_svc la política
// notificacion_tenant de la migración 0007 solo deja leer y escribir filas del tenant fijado en el contexto.
class PgNotificacionRepository extends INotificacionRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgNotificacionRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  // Una oferta de despacho por aliado y solicitud (índice ux_notificacion_oferta_despacho, migración 0019):
  // si ya existe, no se inserta otra y se devuelve la existente con `nueva` false, para que el push no se repita.
  // La existente se busca en una segunda sentencia: si la escribió una orquestación concurrente, la primera
  // sentencia no la ve en su snapshot aunque el ON CONFLICT la haya esperado.
  async createForAlly(ctx, { allyId, tipo, canal, payload }) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const params = [ctx.tenantId, allyId, tipo, canal, JSON.stringify(payload)];
      const insertada = await client.query(
        `INSERT INTO notificacion (tenant_id, usuario_id, tipo, canal, payload)
         SELECT $1, a.usuario_id, $3, $4, $5::jsonb
         FROM aliado a
         WHERE a.id = $2 AND a.tenant_id = $1
         ON CONFLICT (tenant_id, usuario_id, (payload->>'requestId')) WHERE tipo = 'OFERTA_DESPACHO' DO NOTHING
         RETURNING id, usuario_id`,
        params
      );
      if (insertada.rows.length) {
        return { id: insertada.rows[0].id, usuarioId: insertada.rows[0].usuario_id, nueva: true };
      }

      const existente = await client.query(
        `SELECT n.id, n.usuario_id
         FROM notificacion n
         JOIN aliado a ON a.usuario_id = n.usuario_id AND a.tenant_id = n.tenant_id
         WHERE a.id = $2 AND n.tenant_id = $1 AND n.tipo = $3 AND n.payload->>'requestId' = $4::jsonb->>'requestId'
         ORDER BY n.enviado_at, n.id
         LIMIT 1`,
        [ctx.tenantId, allyId, tipo, params[4]]
      );
      return existente.rows.length ? { id: existente.rows[0].id, usuarioId: existente.rows[0].usuario_id, nueva: false } : null;
    });
  }

  async participantesDeSolicitud(ctx, solicitudId) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT s.estado, c.usuario_id AS cliente_usuario_id, a.usuario_id AS aliado_usuario_id, cat.nombre AS categoria
         FROM solicitud s
         JOIN cliente c ON c.id = s.cliente_id AND c.tenant_id = s.tenant_id
         LEFT JOIN aliado a ON a.id = s.aliado_id AND a.tenant_id = s.tenant_id
         LEFT JOIN categoria_servicio cat ON cat.id = s.categoria_id AND cat.tenant_id = s.tenant_id
         WHERE s.id = $1 AND s.tenant_id = $2`,
        [solicitudId, ctx.tenantId]
      );
      if (rows.length === 0) return null;
      return {
        clienteUsuarioId: rows[0].cliente_usuario_id,
        aliadoUsuarioId: rows[0].aliado_usuario_id,
        categoria: rows[0].categoria,
        estado: rows[0].estado,
      };
    });
  }

  // Una notificación por evento y destinatario (índice ux_notificacion_clave_evento, migración 0022). Igual que en
  // createForAlly, la existente se busca en una segunda sentencia: si la escribió un reintento concurrente, la primera
  // no la ve en su snapshot aunque el ON CONFLICT la haya esperado.
  async crearParaUsuario(ctx, { usuarioId, tipo, canal, payload, claveEvento }) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const insertada = await client.query(
        `INSERT INTO notificacion (tenant_id, usuario_id, tipo, canal, payload, clave_evento)
         SELECT $1, u.id, $3, $4, $5::jsonb, $6
         FROM usuario u
         WHERE u.id = $2 AND u.tenant_id = $1
         ON CONFLICT (tenant_id, usuario_id, tipo, clave_evento) WHERE clave_evento IS NOT NULL DO NOTHING
         RETURNING id, usuario_id`,
        [ctx.tenantId, usuarioId, tipo, canal, JSON.stringify(payload), claveEvento]
      );
      if (insertada.rows.length) {
        return { id: insertada.rows[0].id, usuarioId: insertada.rows[0].usuario_id, nueva: true };
      }
      const existente = await client.query(
        `SELECT id, usuario_id FROM notificacion
         WHERE tenant_id = $1 AND usuario_id = $2 AND tipo = $3 AND clave_evento = $4`,
        [ctx.tenantId, usuarioId, tipo, claveEvento]
      );
      return existente.rows.length ? { id: existente.rows[0].id, usuarioId: existente.rows[0].usuario_id, nueva: false } : null;
    });
  }

  async paraEntrega(ctx, notificacionId) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        'SELECT id, usuario_id, tipo, payload FROM notificacion WHERE id = $1 AND tenant_id = $2',
        [notificacionId, ctx.tenantId]
      );
      return rows.length ? { id: rows[0].id, usuarioId: rows[0].usuario_id, tipo: rows[0].tipo, payload: rows[0].payload || {} } : null;
    });
  }

  async listByRequest(ctx, requestId, tipo) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT payload, enviado_at
         FROM notificacion
         WHERE tenant_id = $1 AND tipo = $2 AND payload->>'requestId' = $3
         ORDER BY enviado_at, id`,
        [ctx.tenantId, tipo, requestId]
      );
      return rows.map((row) => ({ payload: row.payload, enviadoAt: row.enviado_at }));
    });
  }

  async listForUser(ctx, { limit }) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT id, tipo, canal, payload, enviado_at, leido_at
         FROM notificacion
         WHERE tenant_id = $1 AND usuario_id = $2
         ORDER BY enviado_at DESC, id
         LIMIT $3`,
        [ctx.tenantId, ctx.userId, limit]
      );
      return rows.map((row) => ({
        id: row.id,
        tipo: row.tipo,
        canal: row.canal,
        payload: row.payload,
        enviadoAt: row.enviado_at,
        leidoAt: row.leido_at,
      }));
    });
  }
}

module.exports = PgNotificacionRepository;
