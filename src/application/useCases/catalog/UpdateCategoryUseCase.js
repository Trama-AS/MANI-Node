const { ValidationError, NotFoundError } = require('../../../domain/errors/DomainError');
const assertCategoryRules = require('./assertCategoryRules');

class UpdateCategoryUseCase {
  constructor({ catalogRepository, ruleEvaluationService }) {
    if (!catalogRepository) {
      throw new Error('catalogRepository es requerido para UpdateCategoryUseCase');
    }
    if (!ruleEvaluationService) {
      throw new Error('ruleEvaluationService es requerido para UpdateCategoryUseCase');
    }
    this.catalogRepository = catalogRepository;
    this.ruleEvaluationService = ruleEvaluationService;
  }

  async execute({ tenantId, categoryId, name, description, flujoOperativo, role, correlationId } = {}) {
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
    if (flujoOperativo !== undefined && (typeof flujoOperativo !== 'string' || !flujoOperativo.trim())) {
      throw new ValidationError('flujoOperativo no puede estar vacío');
    }
    if (name === undefined && description === undefined && flujoOperativo === undefined) {
      throw new ValidationError('Se requiere al menos un campo para actualizar (name, description o flujoOperativo)');
    }

    // description no es una regla operativa: un cambio solo de descripción no consulta a Rules.
    let normalized = {};
    if (name !== undefined || flujoOperativo !== undefined) {
      normalized = await assertCategoryRules(this.ruleEvaluationService, {
        tenantId,
        categoryId,
        role,
        correlationId,
        context: { operation: 'UPDATE', name, flujoOperativo },
      });
    }

    const category = await this.catalogRepository.update(tenantId, categoryId, {
      name: name !== undefined ? (normalized.name ?? name) : undefined,
      description,
      flujoOperativo: flujoOperativo !== undefined ? (normalized.flujoOperativo ?? flujoOperativo) : undefined,
    });
    if (!category) {
      throw new NotFoundError(`No se encontró la categoría ${categoryId} para este tenant`, 'CATEGORY_NOT_FOUND');
    }

    return category.toJSON();
  }
}

module.exports = UpdateCategoryUseCase;
