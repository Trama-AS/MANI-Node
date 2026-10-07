const ISitioRepository = require('../../domain/ports/ISitioRepository');
const { DomainError } = require('../../domain/errors/DomainError');

/**
 * Migración de la porción "sitio" de registrar_cliente_persona_natural
 * (US-02.2.1-M2.2). `zona` no tiene tenant_id (01-schema.sql): es un
 * catálogo global, por eso findFirstActiveZonaId() no filtra por tenant,
 * igual que la función PL/pgSQL legacy.
 */
class SupabaseSitioRepository extends ISitioRepository {
  constructor({ supabaseClientFactory }) {
    super();
    this.supabaseClientFactory = supabaseClientFactory;
  }

  async findFirstActiveZonaId() {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client.from('zona').select('id').eq('estado', 'ACTIVO').limit(1).maybeSingle();

    if (error) throw new DomainError(`Error consultando zonas: ${error.message}`, 'INTERNAL_ERROR', 500);
    return data ? data.id : null;
  }

  async create({ tenantId, clienteId, zonaId, direccion, reglas }) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('sitio')
      .insert({ tenant_id: tenantId, cliente_id: clienteId, zona_id: zonaId, direccion, reglas })
      .select()
      .single();

    if (error) throw new DomainError(`Error creando sitio: ${error.message}`, 'INTERNAL_ERROR', 500);
    return data;
  }

  async deleteByClienteId(tenantId, clienteId) {
    const client = this.supabaseClientFactory.getClient();
    const { error } = await client.from('sitio').delete().eq('tenant_id', tenantId).eq('cliente_id', clienteId);
    if (error) throw new DomainError(`Error eliminando sitio: ${error.message}`, 'INTERNAL_ERROR', 500);
  }
}

module.exports = SupabaseSitioRepository;
