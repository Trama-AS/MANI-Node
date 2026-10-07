const { ValidationError, NotFoundError } = require('../../../domain/errors/DomainError');

class UpdateCategoryUseCase {
  constructor({ catalogRepository }) {
    if (!catalogRepository) {
      throw new Error('catalogRepository es requerido para UpdateCategoryUseCase');
    }
    this.catalogRepository = catalogRepository;
  }

  async execute({ tenantId, categoryId, name, description } = {}) {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new ValidationError('tenantId es requerido');
    }
    if (!categoryId || typeof categoryId !== 'string') {
      throw new ValidationError('categoryId es requerido');
    }
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      throw new ValidationError('name no puede estar vacío');
    }
    if (description !== undefined && typeof description !== 'string') {
      throw new ValidationError('description debe ser una cadena');
    }
    if (name === undefined && description === undefined) {
      throw new ValidationError('Se requiere al menos un campo para actualizar (name o description)');
    }

    const category = await this.catalogRepository.update(tenantId, categoryId, { name, description });
    if (!category) {
      throw new NotFoundError(`No se encontró la categoría ${categoryId} para este tenant`, 'CATEGORY_NOT_FOUND');
    }

    return category.toJSON();
  }
}

module.exports = UpdateCategoryUseCase;
