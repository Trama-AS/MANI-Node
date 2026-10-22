const ITenantRepository = require('../../domain/ports/ITenantRepository');
const Tenant = require('../../domain/entities/Tenant');
const { DomainError } = require('../../domain/errors/DomainError');

const ESTADO_FROM_DB = { ACTIVO: 'ACTIVE', INACTIVO: 'INACTIVE' };

function toDomain(row) {
  if (!row) return null;
  return new Tenant({
    id: row.id,
    name: row.nombre,
    slug: row.slug || row.id,
    status: ESTADO_FROM_DB[row.estado] || row.estado,
  });
}

class SupabaseTenantRepository extends ITenantRepository {
  constructor({ supabaseClientFactory }) {
    super();
    this.supabaseClientFactory = supabaseClientFactory;
  }

  async findAll() {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client.from('tenant').select('id, nombre, slug, estado');
    if (error) throw new DomainError(`Error consultando tenants: ${error.message}`, 'INTERNAL_ERROR', 500);
    return data.map(toDomain);
  }

  async findById(id) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client.from('tenant').select('id, nombre, slug, estado').eq('id', id).maybeSingle();
    if (error) throw new DomainError(`Error consultando tenant: ${error.message}`, 'INTERNAL_ERROR', 500);
    return toDomain(data);
  }

  async findBySlug(slug) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client.from('tenant').select('id, nombre, slug, estado').eq('slug', slug).maybeSingle();
    if (error) throw new DomainError(`Error consultando tenant: ${error.message}`, 'INTERNAL_ERROR', 500);
    return toDomain(data);
  }
}

module.exports = SupabaseTenantRepository;
