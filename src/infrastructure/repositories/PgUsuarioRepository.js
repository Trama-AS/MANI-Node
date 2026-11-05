const IUsuarioRepository = require('../../domain/ports/IUsuarioRepository');
const { ROL_TO_DB, ESTADO_USUARIO_TO_DB } = require('./supabaseEnumMaps');
const { enContextoTenant, filaPlana, fallaDeBase } = require('../db/enContextoTenant');

/**
 * Espejo de negocio de `auth.users` por `pg` como `mani_core_svc` (SCRUM-1468). Antes iba por supabase-js con la
 * clave service_role, que salta RLS; ahora cada operación corre con app.set_context del tenant y la política
 * `usuario_tenant` (0007) es la que impide tocar filas de otro tenant aunque la consulta olvidara filtrarlo.
 */
class PgUsuarioRepository extends IUsuarioRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgUsuarioRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  async findByEmail(tenantId, email) {
    return this.#unaFila(
      tenantId,
      `SELECT id, tenant_id, email, rol, estado
         FROM usuario
        WHERE tenant_id = $1 AND lower(email) = lower($2)
        LIMIT 1`,
      [tenantId, email],
      'Error consultando usuario'
    );
  }

  async create({ id, tenantId, email, rol, estado, phone }) {
    // Mismo upsert por id que hacía handle_new_user (ADR-0022): reintentar un registro no duplica la fila.
    return this.#unaFila(
      tenantId,
      `INSERT INTO usuario (id, tenant_id, email, rol, estado, telefono)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE
          SET tenant_id = EXCLUDED.tenant_id,
              email = EXCLUDED.email,
              rol = EXCLUDED.rol,
              estado = EXCLUDED.estado,
              -- Sin teléfono en la petición se conserva el guardado, como hacía el upsert de supabase-js.
              telefono = COALESCE(EXCLUDED.telefono, usuario.telefono)
       RETURNING *`,
      [id, tenantId, email, ROL_TO_DB[rol] || rol, ESTADO_USUARIO_TO_DB[estado] || estado, phone ?? null],
      'Error creando usuario'
    );
  }

  async deleteById(tenantId, id) {
    try {
      await enContextoTenant(this.pgPoolFactory, tenantId, (client) =>
        client.query('DELETE FROM usuario WHERE tenant_id = $1 AND id = $2', [tenantId, id])
      );
    } catch (err) {
      throw fallaDeBase('Error eliminando usuario', err);
    }
  }

  async findById(tenantId, id) {
    return this.#unaFila(
      tenantId,
      `SELECT id, tenant_id, email, rol, estado, telefono
         FROM usuario
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id],
      'Error consultando usuario por id'
    );
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

module.exports = PgUsuarioRepository;
