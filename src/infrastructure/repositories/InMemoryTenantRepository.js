const ITenantRepository = require('../../domain/ports/ITenantRepository');
const Tenant = require('../../domain/entities/Tenant');

class InMemoryTenantRepository extends ITenantRepository {
  constructor() {
    super();
    this.tenants = [
      new Tenant({ id: 'trama-demo', slug: 'trama-demo', name: 'TRAMA Servicios Demo', status: 'ACTIVE' }),
      new Tenant({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', slug: 'plomeria-express', name: 'Plomería Express CDMX SA', status: 'ACTIVE' }),
      new Tenant({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', slug: 'electricistas-pro', name: 'Electricistas Pro Monterrey', status: 'ACTIVE' }),
      new Tenant({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', slug: 'cerrajeria-total', name: 'Cerrajería Total GDL', status: 'ACTIVE' }),
    ];
  }

  async findAll() {
    return [...this.tenants];
  }

  async findById(id) {
    return this.tenants.find((t) => t.id === id) || null;
  }

  async findBySlug(slug) {
    return this.tenants.find((t) => t.slug === slug) || null;
  }
}

module.exports = InMemoryTenantRepository;

