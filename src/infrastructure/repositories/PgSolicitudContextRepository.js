const ISolicitudContextRepository = require('../../domain/ports/ISolicitudContextRepository');
const { runInTenantContext } = require('../db/runInTenantContext');

// Quién ve el contexto (HU-M05-03, C3): el admin del tenant, el cliente dueño, el aliado asignado y el aliado
// que recibió la oferta de despacho. Cualquier otra sesión obtiene null, igual que si el id no existiera.
const CONTEXT_SQL = `
  SELECT s.id, s.tenant_id, s.zona_id, s.categoria_id, s.estado,
         (asig.usuario_id IS NOT NULL AND asig.usuario_id = $4) AS es_mia
  FROM solicitud s
  JOIN cliente c ON c.id = s.cliente_id AND c.tenant_id = s.tenant_id
  LEFT JOIN aliado asig ON asig.id = s.aliado_id AND asig.tenant_id = s.tenant_id
  WHERE s.id = $1 AND s.tenant_id = $2
    AND (
      $3 = 'ADMIN'
      OR ($3 = 'CLIENT' AND c.usuario_id = $4)
      OR ($3 = 'ALLY' AND (
        asig.usuario_id = $4
        OR EXISTS (
          SELECT 1 FROM notificacion n
          WHERE n.tenant_id = s.tenant_id AND n.usuario_id = $4
            AND n.tipo = 'OFERTA_DESPACHO' AND n.payload->>'requestId' = s.id::text
        )
      ))
    )`;

class PgSolicitudContextRepository extends ISolicitudContextRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgSolicitudContextRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async findContext(ctx, solicitudId) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(CONTEXT_SQL, [solicitudId, ctx.tenantId, ctx.role, ctx.userId]);
      if (rows.length === 0) return null;
      const row = rows[0];
      return {
        id: row.id,
        tenantId: row.tenant_id,
        zonaId: row.zona_id,
        categoriaId: row.categoria_id,
        estado: row.estado,
        esMia: row.es_mia,
      };
    });
  }
}

module.exports = PgSolicitudContextRepository;
