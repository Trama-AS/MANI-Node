const { ValidationError } = require('../../../domain/errors/DomainError');

class ListCategoriesForTenantUseCase {
  constructor({ catalogRepository }) {
    if (!catalogRepository) {
      throw new Error('catalogRepository es requerido para ListCategoriesForTenantUseCase');
    }
    this.catalogRepository = catalogRepository;
  }

  async execute({ tenantId, onlyActive = false } = {}) {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new ValidationError('tenantId es requerido');
    }

    const categories = await this.catalogRepository.findAllByTenant(tenantId, { onlyActive });
    return categories.map((c) => c.toJSON());
  }
}

module.exports = ListCategoriesForTenantUseCase;
