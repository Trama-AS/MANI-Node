class ListTenantsUseCase {
  constructor({ tenantRepository }) {
    if (!tenantRepository) {
      throw new Error('tenantRepository es requerido para ListTenantsUseCase');
    }
    this.tenantRepository = tenantRepository;
  }

  async execute() {
    const tenants = await this.tenantRepository.findAll();
    return tenants.map((tenant) => (typeof tenant.toJSON === 'function' ? tenant.toJSON() : tenant));
  }
}

module.exports = ListTenantsUseCase;

