const ITenantStatusRepository = require('../../domain/ports/ITenantStatusRepository');
const { ConflictError, NotFoundError } = require('../../domain/errors/DomainError');
const { runInTenantContext } = require('../db/runInTenantContext');

const ESTADO_DESDE_BD = { ACTIVO: 'ACTIVE', SUSPENDIDO: 'SUSPENDED', INACTIVO: 'INACTIVE' };
const estadoDominio = (estado) => ESTADO_DESDE_BD[estado] || estado;

function toCambio(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    estadoAnterior: estadoDominio(row.estado_anterior),
    estadoNuevo: estadoDominio(row.estado_nuevo),
    motivo: row.motivo,
    actor: { id: row.actor_id, rol: row.actor_rol, tenantId: row.actor_tenant_id },
    correlationId: row.correlation_id,
    fecha: row.created_at,
  };
}

const tenantNoEncontrado = () => new NotFoundError('MANI-TEN-404: tenant no encontrado', 'MANI-TEN-404');

/**
 * Estado del tenant sobre `pg` con withTenantContext (ADR-0032). El contexto lleva el tenant de origen del
 * administrador de plataforma; la política `tenant_estado_plataforma` (migración 0031) le deja actualizar `estado` de
 * cualquier tenant solo con el rol admin_plataforma, y el cambio y su registro van en la misma transacción.
 */
class PgTenantStatusRepository extends ITenantStatusRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgTenantStatusRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async cambiarEstado(ctx, datos) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const actual = await client.query('SELECT id, nombre, slug, estado FROM tenant WHERE id = $1 FOR UPDATE', [datos.tenantId]);
      if (actual.rows.length === 0) throw tenantNoEncontrado();
      const anterior = actual.rows[0].estado;
      if (anterior === datos.estado) {
        throw new ConflictError(`MANI-TEN-409: el tenant ya está en estado ${estadoDominio(anterior)}`, 'MANI-TEN-409');
      }

      await client.query('UPDATE tenant SET estado = $1 WHERE id = $2', [datos.estado, datos.tenantId]);
      const cambio = await client.query(
        `INSERT INTO tenant_estado_cambio (tenant_id, estado_anterior, estado_nuevo, motivo, actor_id, actor_rol,
           actor_tenant_id, correlation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [datos.tenantId, anterior, datos.estado, datos.motivo, ctx.userId, ctx.role, ctx.tenantId, datos.correlationId]
      );
      const t = actual.rows[0];
      return {
        tenant: { id: t.id, name: t.nombre, slug: t.slug, status: estadoDominio(datos.estado) },
        cambio: toCambio(cambio.rows[0]),
      };
    });
  }

  async historial(ctx, { tenantId }) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const existe = await client.query('SELECT 1 FROM tenant WHERE id = $1', [tenantId]);
      if (existe.rows.length === 0) throw tenantNoEncontrado();
      const { rows } = await client.query(
        'SELECT * FROM tenant_estado_cambio WHERE tenant_id = $1 ORDER BY created_at DESC, id',
        [tenantId]
      );
      return rows.map(toCambio);
    });
  }
}

module.exports = PgTenantStatusRepository;
