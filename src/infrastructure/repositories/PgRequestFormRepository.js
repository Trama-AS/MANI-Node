const IRequestFormRepository = require('../../domain/ports/IRequestFormRepository');
const { ForbiddenError } = require('../../domain/errors/DomainError');
const { runInTenantContext } = require('../db/runInTenantContext');

// Mismo criterio que `crear_solicitud` y PgServiceRequestRepository: solo un cliente activo del tenant.
async function clienteActivo(client, ctx) {
  const { rows } = await client.query(
    `SELECT c.id FROM cliente c JOIN usuario u ON u.id = c.usuario_id
     WHERE c.usuario_id = $1 AND c.tenant_id = $2 AND u.estado = 'ACTIVO'`,
    [ctx.userId, ctx.tenantId]
  );
  if (rows.length === 0) {
    throw new ForbiddenError('MANI-SOL-403C: solo un cliente activo puede publicar solicitudes', 'MANI-SOL-403C');
  }
  return rows[0].id;
}

/**
 * Lecturas del formulario de solicitud sobre `pg`, con el contexto de tenant del JWT (ADR-0032).
 * Portan `listar_categorias_cliente` y `listar_mis_sitios` (006) con los mismos filtros y el mismo orden.
 */
class PgRequestFormRepository extends IRequestFormRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgRequestFormRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async listarCategorias(ctx) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      await clienteActivo(client, ctx);
      const { rows } = await client.query(
        `SELECT id, nombre, flujo_operativo FROM categoria_servicio
         WHERE tenant_id = $1 AND estado = 'ACTIVO'
         ORDER BY lower(nombre)`,
        [ctx.tenantId]
      );
      return rows.map((r) => ({ id: r.id, nombre: r.nombre, flujoOperativo: r.flujo_operativo }));
    });
  }

  async listarSitios(ctx) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const clienteId = await clienteActivo(client, ctx);
      const { rows } = await client.query(
        `SELECT s.id, s.nombre, s.direccion, s.zona_id, z.nombre AS zona, zp.nombre AS zona_padre
         FROM sitio s
         JOIN zona z ON z.id = s.zona_id
         LEFT JOIN zona zp ON zp.id = z.zona_padre_id
         WHERE s.cliente_id = $1 AND s.tenant_id = $2
         ORDER BY s.created_at DESC`,
        [clienteId, ctx.tenantId]
      );
      return rows.map((r) => ({
        id: r.id,
        // Los sitios creados desde la solicitud no tienen nombre: se muestra la dirección, como en Site.
        nombre: r.nombre || r.direccion,
        direccion: r.direccion,
        zonaId: r.zona_id,
        zona: r.zona,
        zonaPadre: r.zona_padre,
      }));
    });
  }
}

module.exports = PgRequestFormRepository;
