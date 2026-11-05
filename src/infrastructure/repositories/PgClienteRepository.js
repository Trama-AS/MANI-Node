const IClienteRepository = require('../../domain/ports/IClienteRepository');
const { enContextoTenant, filaPlana, fallaDeBase } = require('../db/enContextoTenant');

/**
 * Clientes por `pg` como `mani_core_svc` (SCRUM-1468), con app.set_context del tenant: la política `cliente_tenant`
 * (0007) aísla las filas aunque una consulta olvidara filtrar el tenant.
 */
class PgClienteRepository extends IClienteRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgClienteRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async create({ tenantId, usuarioId, tipo, razonSocial, nit, telefono, nombreRepresentante }) {
    // Upsert por usuario_id, como el de supabase-js; un dato que no llega conserva el guardado.
    return this.#unaFila(
      tenantId,
      `INSERT INTO cliente (tenant_id, usuario_id, tipo, razon_social, nit, telefono, nombre_representante)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (usuario_id) DO UPDATE
          SET tenant_id = EXCLUDED.tenant_id,
              tipo = EXCLUDED.tipo,
              razon_social = COALESCE(EXCLUDED.razon_social, cliente.razon_social),
              nit = COALESCE(EXCLUDED.nit, cliente.nit),
              telefono = COALESCE(EXCLUDED.telefono, cliente.telefono),
              nombre_representante = COALESCE(EXCLUDED.nombre_representante, cliente.nombre_representante)
       RETURNING *`,
      [tenantId, usuarioId, tipo, razonSocial ?? null, nit ?? null, telefono ?? null, nombreRepresentante ?? null],
      'Error creando cliente'
    );
  }

  async findByNit(tenantId, nit) {
    return this.#unaFila(
      tenantId,
      'SELECT id, usuario_id, nit FROM cliente WHERE tenant_id = $1 AND nit = $2 LIMIT 1',
      [tenantId, nit],
      'Error consultando cliente por NIT'
    );
  }

  async deleteByUsuarioId(tenantId, usuarioId) {
    try {
      await enContextoTenant(this.pgPoolFactory, tenantId, (client) =>
        client.query('DELETE FROM cliente WHERE tenant_id = $1 AND usuario_id = $2', [tenantId, usuarioId])
      );
    } catch (err) {
      throw fallaDeBase('Error eliminando cliente', err);
    }
  }

  async #unaFila(tenantId, sql, params, mensaje) {
    try {
      const { rows } = await enContextoTenant(this.pgPoolFactory, tenantId, (client) => client.query(sql, params));
      return filaPlana(rows[0] ?? null);
    } catch (err) {
      throw fallaDeBase(mensaje, err);
    }
  }
}

module.exports = PgClienteRepository;
