const { ValidationError } = require('../../../domain/errors/DomainError');

class CreateCategoryUseCase {
  constructor({ catalogRepository }) {
    if (!catalogRepository) {
      throw new Error('catalogRepository es requerido para CreateCategoryUseCase');
    }
    this.catalogRepository = catalogRepository;
  }

  async execute({ tenantId, name, description } = {}) {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new ValidationError('tenantId es requerido');
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new ValidationError('name es requerido');
    }
    if (description !== undefined && typeof description !== 'string') {
      throw new ValidationError('description debe ser una cadena');
    }

    const category = await this.catalogRepository.create(tenantId, { name, description });
    return category.toJSON();
  }
}

module.exports = CreateCategoryUseCase;
