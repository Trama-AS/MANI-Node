const IAliadoCategoriaRepository = require('../../domain/ports/IAliadoCategoriaRepository');
const { DomainError } = require('../../domain/errors/DomainError');

/**
 * Migración de la porción aliado_categoria de registrar_aliado_persona_natural
 * (ADR-0022). El trigger trg_aliado_categoria_tenant (database/migrations/
 * 004_aliado_categorias.sql) sigue validando que aliado y categoría compartan
 * tenant_id — este repositorio no lo duplica, solo lo que ya hace falta.
 */
class SupabaseAliadoCategoriaRepository extends IAliadoCategoriaRepository {
  constructor({ supabaseClientFactory }) {
    super();
    this.supabaseClientFactory = supabaseClientFactory;
  }

  async create({ tenantId, aliadoId, categoriaId }) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('aliado_categoria')
      .insert({ tenant_id: tenantId, aliado_id: aliadoId, categoria_id: categoriaId })
      .select()
      .single();

    if (error) throw new DomainError(`Error asociando categoría al aliado: ${error.message}`, 'INTERNAL_ERROR', 500);
    return data;
  }

  async findByAliadoId(tenantId, aliadoId) {
    const client = this.supabaseClientFactory.getClient();
    let query = client
      .from('aliado_categoria')
      .select('categoria_id')
      .eq('aliado_id', aliadoId);
    if (tenantId) query = query.eq('tenant_id', tenantId);

    const { data, error } = await query;
    if (error) throw new DomainError(`Error consultando categorías del aliado: ${error.message}`, 'INTERNAL_ERROR', 500);
    return (data || []).map((row) => row.categoria_id);
  }

  async setAliadoCategorias(tenantId, aliadoId, categoriaIds) {
    const client = this.supabaseClientFactory.getClient();
    const current = await this.findByAliadoId(tenantId, aliadoId);

    const toDelete = current.filter((id) => !categoriaIds.includes(id));
    const toInsert = categoriaIds.filter((id) => !current.includes(id));

    if (toDelete.length > 0) {
      let query = client
        .from('aliado_categoria')
        .delete()
        .eq('aliado_id', aliadoId)
        .in('categoria_id', toDelete);
      if (tenantId) query = query.eq('tenant_id', tenantId);

      const { error: delError } = await query;
      if (delError) throw new DomainError(`Error eliminando categorías anteriores: ${delError.message}`, 'INTERNAL_ERROR', 500);
    }

    if (toInsert.length > 0) {
      const rows = toInsert.map((categoriaId) => ({
        tenant_id: tenantId,
        aliado_id: aliadoId,
        categoria_id: categoriaId,
      }));
      const { error: insError } = await client
        .from('aliado_categoria')
        .insert(rows);
      if (insError) throw new DomainError(`Error guardando categorías: ${insError.message}`, 'INTERNAL_ERROR', 500);
    }

    return this.findByAliadoId(tenantId, aliadoId);
  }

  async deleteByAliadoId(tenantId, aliadoId) {
    const client = this.supabaseClientFactory.getClient();
    const { error } = await client
      .from('aliado_categoria')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('aliado_id', aliadoId);
    if (error) throw new DomainError(`Error eliminando categorías del aliado: ${error.message}`, 'INTERNAL_ERROR', 500);
  }
}

module.exports = SupabaseAliadoCategoriaRepository;
