const { ValidationError, NotFoundError } = require('../../../domain/errors/DomainError');

/**
 * Flujo operativo de la categoría (US-03.1.1-M2.1): activar/desactivar sin
 * borrado físico, para no romper referencias existentes en aliado_categoria.
 */
class SetCategoryStatusUseCase {
  constructor({ catalogRepository }) {
    if (!catalogRepository) {
      throw new Error('catalogRepository es requerido para SetCategoryStatusUseCase');
    }
    this.catalogRepository = catalogRepository;
  }

  async execute({ tenantId, categoryId, active } = {}) {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new ValidationError('tenantId es requerido');
    }
    if (!categoryId || typeof categoryId !== 'string') {
      throw new ValidationError('categoryId es requerido');
    }
    if (typeof active !== 'boolean') {
      throw new ValidationError('active es requerido y debe ser booleano');
    }

    const category = await this.catalogRepository.setActive(tenantId, categoryId, active);
    if (!category) {
      throw new NotFoundError(`No se encontró la categoría ${categoryId} para este tenant`, 'CATEGORY_NOT_FOUND');
    }

    return category.toJSON();
  }
}

module.exports = SetCategoryStatusUseCase;
