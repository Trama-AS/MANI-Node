const { ValidationError, NotFoundError } = require('../../../domain/errors/DomainError');

class GetCategoryUseCase {
  constructor({ catalogRepository }) {
    if (!catalogRepository) {
      throw new Error('catalogRepository es requerido para GetCategoryUseCase');
    }
    this.catalogRepository = catalogRepository;
  }

  async execute({ tenantId, categoryId } = {}) {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new ValidationError('tenantId es requerido');
    }
    if (!categoryId || typeof categoryId !== 'string') {
      throw new ValidationError('categoryId es requerido');
    }

    const category = await this.catalogRepository.findById(tenantId, categoryId);
    if (!category || category.tenantId !== tenantId) {
      throw new NotFoundError(`No se encontró la categoría ${categoryId} para este tenant`, 'CATEGORY_NOT_FOUND');
    }

    return category.toJSON();
  }
}

module.exports = GetCategoryUseCase;
