const ITenantRepository = require('../../domain/ports/ITenantRepository');
const Tenant = require('../../domain/entities/Tenant');

class InMemoryTenantRepository extends ITenantRepository {
  constructor() {
    super();
    this.tenants = [
      new Tenant({ id: 'trama-demo', name: 'TRAMA Servicios Demo', status: 'ACTIVE' }),
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

