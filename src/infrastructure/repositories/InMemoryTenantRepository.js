const ITenantRepository = require('../../domain/ports/ITenantRepository');
const Tenant = require('../../domain/entities/Tenant');

class InMemoryTenantRepository extends ITenantRepository {
  constructor() {
    super();
    this.tenants = [
      new Tenant({ id: 'trama-demo', name: 'TRAMA Servicios Demo', status: 'ACTIVE' }),
      // UUIDs del dropdown de MANI-Flutter (registro_aliado_page.dart), para que
      // DEV local sin Supabase acepte lo que la UI realmente envía.
      new Tenant({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', name: 'Plomería Express CDMX SA', status: 'ACTIVE' }),
      new Tenant({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22', name: 'Electricistas Pro Monterrey', status: 'ACTIVE' }),
      new Tenant({ id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33', name: 'Cerrajería Total GDL', status: 'ACTIVE' }),
    ];
  }

  async findAll() {
    return [...this.tenants];
  }

  async findById(id) {
    return this.tenants.find((t) => t.id === id) || null;
  }
}

module.exports = InMemoryTenantRepository;

