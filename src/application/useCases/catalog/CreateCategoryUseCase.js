const { ValidationError } = require('../../../domain/errors/DomainError');
const Category = require('../../../domain/entities/Category');

class CreateCategoryUseCase {
  constructor({ catalogRepository }) {
    if (!catalogRepository) {
      throw new Error('catalogRepository es requerido para CreateCategoryUseCase');
    }
    this.catalogRepository = catalogRepository;
  }

  async execute({ tenantId, name, description, flujoOperativo } = {}) {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new ValidationError('tenantId es requerido');
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new ValidationError('name es requerido');
    }
    if (description !== undefined && typeof description !== 'string') {
      throw new ValidationError('description debe ser una cadena');
    }
    if (!Category.VALID_FLUJO_OPERATIVO.includes(flujoOperativo)) {
      throw new ValidationError(
        `flujoOperativo es requerido. Valores permitidos: ${Category.VALID_FLUJO_OPERATIVO.join(', ')}`
      );
    }

    // La detección de nombre duplicado por tenant vive en el repositorio
    // (InMemory la hace de forma síncrona in-process; Supabase confía en el
    // índice único ux_categoria_tenant_nombre y traduce 23505 a
    // ConflictError), para no duplicar esa regla en dos capas.
    const category = await this.catalogRepository.create(tenantId, { name, description, flujoOperativo });
    return category.toJSON();
  }
}

module.exports = CreateCategoryUseCase;
