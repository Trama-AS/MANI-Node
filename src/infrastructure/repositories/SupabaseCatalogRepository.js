const ICatalogRepository = require('../../domain/ports/ICatalogRepository');
const Category = require('../../domain/entities/Category');
const { DomainError } = require('../../domain/errors/DomainError');

function toDomain(row) {
  if (!row) return null;
  return new Category({ id: row.id, name: row.nombre, active: row.estado === 'ACTIVO' });
}

class SupabaseCatalogRepository extends ICatalogRepository {
  constructor({ supabaseClientFactory }) {
    super();
    this.supabaseClientFactory = supabaseClientFactory;
  }

  async findAllCategories() {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client.from('categoria_servicio').select('id, nombre, estado');
    if (error) throw new DomainError(`Error consultando categorías: ${error.message}`, 'INTERNAL_ERROR', 500);
    return data.map(toDomain);
  }

  async findActiveByTenant(tenantId) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('categoria_servicio')
      .select('id, nombre, estado')
      .eq('tenant_id', tenantId)
      .eq('estado', 'ACTIVO')
      .order('nombre', { ascending: true });
    if (error) throw new DomainError(`Error consultando categorías: ${error.message}`, 'INTERNAL_ERROR', 500);
    return (data || []).map(toDomain);
  }

  async findById(tenantId, categoryId) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('categoria_servicio')
      .select('id, nombre, estado')
      .eq('tenant_id', tenantId)
      .eq('id', categoryId)
      .maybeSingle();

    if (error) throw new DomainError(`Error consultando categoría: ${error.message}`, 'INTERNAL_ERROR', 500);
    return toDomain(data);
  }
}

module.exports = SupabaseCatalogRepository;
