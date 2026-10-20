const { ValidationError, NotFoundError } = require('../../../domain/errors/DomainError');
const Category = require('../../../domain/entities/Category');

class UpdateCategoryUseCase {
  constructor({ catalogRepository }) {
    if (!catalogRepository) {
      throw new Error('catalogRepository es requerido para UpdateCategoryUseCase');
    }
    this.catalogRepository = catalogRepository;
  }

  async execute({ tenantId, categoryId, name, description, flujoOperativo } = {}) {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new ValidationError('tenantId es requerido');
    }
    if (!categoryId || typeof categoryId !== 'string') {
      throw new ValidationError('categoryId es requerido');
    }
    // Solo se validan los campos que cambian: una categoría histórica con un
    // nombre fuera de las reglas actuales puede editarse sin renombrarla.
    const normalizedName = name !== undefined ? Category.assertValidName(name) : undefined;
    if (description !== undefined && typeof description !== 'string') {
      throw new ValidationError('description debe ser una cadena');
    }
    if (flujoOperativo !== undefined) {
      Category.assertValidFlujoOperativo(flujoOperativo);
    }
    if (name === undefined && description === undefined && flujoOperativo === undefined) {
      throw new ValidationError('Se requiere al menos un campo para actualizar (name, description o flujoOperativo)');
    }

    const category = await this.catalogRepository.update(tenantId, categoryId, {
      name: normalizedName,
      description,
      flujoOperativo,
    });
    if (!category) {
      throw new NotFoundError(`No se encontró la categoría ${categoryId} para este tenant`, 'CATEGORY_NOT_FOUND');
    }

    return category.toJSON();
  }
}

module.exports = UpdateCategoryUseCase;
