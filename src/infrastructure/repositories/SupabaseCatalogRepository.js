const ICatalogRepository = require('../../domain/ports/ICatalogRepository');
const Category = require('../../domain/entities/Category');
const { DomainError } = require('../../domain/errors/DomainError');

const SELECT_COLUMNS = 'id, nombre, estado, descripcion, tenant_id';

function toDomain(row) {
  if (!row) return null;
  return new Category({
    id: row.id,
    name: row.nombre,
    active: row.estado === 'ACTIVO',
    description: row.descripcion || '',
    tenantId: row.tenant_id,
  });
}

class SupabaseCatalogRepository extends ICatalogRepository {
  constructor({ supabaseClientFactory }) {
    super();
    this.supabaseClientFactory = supabaseClientFactory;
  }

  async findAllCategories() {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client.from('categoria_servicio').select(SELECT_COLUMNS);
    if (error) throw new DomainError(`Error consultando categorías: ${error.message}`, 'INTERNAL_ERROR', 500);
    return data.map(toDomain);
  }

  async findById(tenantId, categoryId) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('categoria_servicio')
      .select(SELECT_COLUMNS)
      .eq('tenant_id', tenantId)
      .eq('id', categoryId)
      .maybeSingle();

    if (error) throw new DomainError(`Error consultando categoría: ${error.message}`, 'INTERNAL_ERROR', 500);
    return toDomain(data);
  }

  async findAllByTenant(tenantId, { onlyActive = false } = {}) {
    const client = this.supabaseClientFactory.getClient();
    let query = client.from('categoria_servicio').select(SELECT_COLUMNS).eq('tenant_id', tenantId);
    if (onlyActive) query = query.eq('estado', 'ACTIVO');

    const { data, error } = await query;
    if (error) throw new DomainError(`Error consultando categorías del tenant: ${error.message}`, 'INTERNAL_ERROR', 500);
    return data.map(toDomain);
  }

  async create(tenantId, { name, description }) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('categoria_servicio')
      .insert({ tenant_id: tenantId, nombre: name, descripcion: description || null, estado: 'ACTIVO' })
      .select(SELECT_COLUMNS)
      .single();

    if (error) throw new DomainError(`Error creando categoría: ${error.message}`, 'INTERNAL_ERROR', 500);
    return toDomain(data);
  }

  async update(tenantId, categoryId, { name, description }) {
    const client = this.supabaseClientFactory.getClient();
    const payload = {};
    if (name !== undefined) payload.nombre = name;
    if (description !== undefined) payload.descripcion = description;

    const { data, error } = await client
      .from('categoria_servicio')
      .update(payload)
      .eq('tenant_id', tenantId)
      .eq('id', categoryId)
      .select(SELECT_COLUMNS)
      .maybeSingle();

    if (error) throw new DomainError(`Error actualizando categoría: ${error.message}`, 'INTERNAL_ERROR', 500);
    return toDomain(data);
  }

  async setActive(tenantId, categoryId, active) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('categoria_servicio')
      .update({ estado: active ? 'ACTIVO' : 'INACTIVO' })
      .eq('tenant_id', tenantId)
      .eq('id', categoryId)
      .select(SELECT_COLUMNS)
      .maybeSingle();

    if (error) {
      throw new DomainError(`Error actualizando el estado de la categoría: ${error.message}`, 'INTERNAL_ERROR', 500);
    }
    return toDomain(data);
  }
}

module.exports = SupabaseCatalogRepository;
