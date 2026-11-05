const { runInTenantContext } = require('../db/runInTenantContext');

/**
 * Lecturas que necesita el contexto efectivo del administrador de plataforma (SCRUM-901): confirmar el tenant
 * elegido y el usuario con el que va a actuar, y listar los usuarios de un tenant para elegirlo.
 *
 * Cada consulta corre con el contexto del tenant destino (RLS de `usuario`: tenant_id = app.tenant_id()), así que
 * nunca devuelve usuarios de otro tenant aunque el id exista.
 */
class PgContextoPlataformaRepository {
  constructor({ pgPoolFactory }) {
    if (!pgPoolFactory) throw new Error('PgContextoPlataformaRepository: pgPoolFactory es requerido');
    this.pgPoolFactory = pgPoolFactory;
  }

  _enTenant(tenantId, work) {
    return runInTenantContext(this.pgPoolFactory, { tenantId, role: 'ADMIN' }, work);
  }

  /** `{ id, nombre, slug, estado }` del tenant, o null si no existe. */
  async obtenerTenant(tenantId) {
    return this._enTenant(tenantId, async (client) => {
      const { rows } = await client.query('SELECT id, nombre, slug, estado FROM tenant WHERE id = $1', [tenantId]);
      return rows[0] || null;
    });
  }

  /** `{ id, email, rol, estado }` del usuario si pertenece al tenant; null si no. */
  async obtenerUsuario(tenantId, usuarioId) {
    return this._enTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        'SELECT id, email, rol, estado FROM usuario WHERE id = $1 AND tenant_id = $2',
        [usuarioId, tenantId]
      );
      return rows[0] || null;
    });
  }

  /** Usuarios del tenant, ordenados por rol y correo. */
  async listarUsuarios(tenantId) {
    return this._enTenant(tenantId, async (client) => {
      const { rows } = await client.query(
        'SELECT id, email, rol, estado FROM usuario WHERE tenant_id = $1 ORDER BY rol, email LIMIT 500',
        [tenantId]
      );
      return rows;
    });
  }
}

module.exports = PgContextoPlataformaRepository;
