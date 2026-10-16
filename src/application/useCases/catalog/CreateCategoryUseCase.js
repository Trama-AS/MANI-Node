const { ValidationError } = require('../../../domain/errors/DomainError');
const assertCategoryRules = require('./assertCategoryRules');

class CreateCategoryUseCase {
  constructor({ catalogRepository, ruleEvaluationService }) {
    if (!catalogRepository) {
      throw new Error('catalogRepository es requerido para CreateCategoryUseCase');
    }
    if (!ruleEvaluationService) {
      throw new Error('ruleEvaluationService es requerido para CreateCategoryUseCase');
    }
    this.catalogRepository = catalogRepository;
    this.ruleEvaluationService = ruleEvaluationService;
  }

  async execute({ tenantId, name, description, flujoOperativo, role, correlationId } = {}) {
    // Core solo valida la forma de la petición; las reglas de negocio
    // (longitud/letras del nombre, flujos permitidos) las decide Rules.
    if (!tenantId || typeof tenantId !== 'string') {
      throw new ValidationError('tenantId es requerido');
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new ValidationError('name es requerido');
    }
    if (description !== undefined && typeof description !== 'string') {
      throw new ValidationError('description debe ser una cadena');
    }
    if (!flujoOperativo || typeof flujoOperativo !== 'string' || !flujoOperativo.trim()) {
      throw new ValidationError('flujoOperativo es requerido');
    }

    const normalized = await assertCategoryRules(this.ruleEvaluationService, {
      tenantId,
      role,
      correlationId,
      context: { operation: 'CREATE', name, flujoOperativo },
    });

    // La detección de nombre duplicado por tenant vive en el repositorio
    // (InMemory la hace de forma síncrona in-process; Supabase confía en el
    // índice único ux_categoria_tenant_nombre y traduce 23505 a
    // ConflictError): necesita estado, por eso no es una regla de Rules.
    const category = await this.catalogRepository.create(tenantId, {
      name: normalized.name ?? name,
      description,
      flujoOperativo: normalized.flujoOperativo ?? flujoOperativo,
    });
    return category.toJSON();
  }
}

module.exports = CreateCategoryUseCase;
