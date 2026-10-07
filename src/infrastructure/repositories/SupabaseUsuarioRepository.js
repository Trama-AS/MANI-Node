const IUsuarioRepository = require('../../domain/ports/IUsuarioRepository');
const { DomainError } = require('../../domain/errors/DomainError');
const { ROL_TO_DB, ESTADO_USUARIO_TO_DB } = require('./supabaseEnumMaps');

/**
 * Migración de la porción "usuario" de handle_new_user (ADR-0022): antes era un
 * INSERT ... ON CONFLICT (id) DO UPDATE dentro de un trigger de Postgres; ahora
 * es este mismo upsert, pero ejecutado explícitamente desde Core Node.
 */
class SupabaseUsuarioRepository extends IUsuarioRepository {
  constructor({ supabaseClientFactory }) {
    super();
    this.supabaseClientFactory = supabaseClientFactory;
  }

  async findByEmail(tenantId, email) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('usuario')
      .select('id, tenant_id, email, rol, estado')
      .eq('tenant_id', tenantId)
      .ilike('email', email)
      .maybeSingle();

    if (error) throw new DomainError(`Error consultando usuario: ${error.message}`, 'INTERNAL_ERROR', 500);
    return data;
  }

  async create({ id, tenantId, email, rol, estado, phone }) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('usuario')
      .upsert(
        {
          id,
          tenant_id: tenantId,
          email,
          rol: ROL_TO_DB[rol] || rol,
          estado: ESTADO_USUARIO_TO_DB[estado] || estado,
          telefono: phone,
        },
        { onConflict: 'id' }
      )
      .select()
      .single();

    if (error) throw new DomainError(`Error creando usuario: ${error.message}`, 'INTERNAL_ERROR', 500);
    return data;
  }
}

module.exports = SupabaseUsuarioRepository;
