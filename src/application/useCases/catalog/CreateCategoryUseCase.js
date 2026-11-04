const { ValidationError, UnauthorizedError } = require('../../../domain/errors/DomainError');
const assertCategoryRules = require('./assertCategoryRules');

/**
 * Creación de categoría de servicio (US-03.1.1-M2.1, HU-M04-01 / SCRUM-1390).
 *
 * Crear una categoría es una operación administrativa, así que queda auditada
 * con quién, cuándo y el correlationId (T10 / RNF-04), igual que el cambio de
 * estado de SCRUM-1391 y la verificación de aliados de SCRUM-1066. Sin usuario
 * en la sesión no se crea, porque no se podría registrar quién lo hizo.
 */
class CreateCategoryUseCase {
  constructor({
    catalogRepository,
    ruleEvaluationService,
    auditLogger = (entry) => console.info(JSON.stringify(entry)),
    now = () => new Date(),
  }) {
    if (!catalogRepository) {
      throw new Error('catalogRepository es requerido para CreateCategoryUseCase');
    }
    if (!ruleEvaluationService) {
      throw new Error('ruleEvaluationService es requerido para CreateCategoryUseCase');
    }
    this.catalogRepository = catalogRepository;
    this.ruleEvaluationService = ruleEvaluationService;
    this.auditLogger = auditLogger;
    this.now = now;
  }

  async execute({ tenantId, name, description, flujoOperativo, role, userId, correlationId = 'none' } = {}) {
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
    if (!userId || typeof userId !== 'string') {
      throw new UnauthorizedError('La sesión no trae el usuario que crea la categoría', 'UNAUTHORIZED');
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

    // T10 (RNF-04): quién, cuándo, qué se creó y el correlationId, sin PII.
    // Se registra despues de crear: una creación rechazada por las reglas de
    // Rules o por nombre duplicado no deja rastro de algo que no existe.
    this.auditLogger({
      event: 'US-03.1.1.crear_categoria',
      tenant_id: tenantId,
      categoria_id: category.id,
      nombre: category.name,
      flujo_operativo: category.flujoOperativo,
      realizado_por: userId,
      fecha: this.now().toISOString(),
      correlation_id: correlationId,
    });

    return category.toJSON();
  }
}

module.exports = CreateCategoryUseCase;
