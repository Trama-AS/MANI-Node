const { ValidationError, NotFoundError, UnauthorizedError } = require('../../../domain/errors/DomainError');

/**
 * Flujo operativo de la categoría (US-03.1.1-M2.1): activar/desactivar sin
 * borrado físico, para no romper referencias existentes en aliado_categoria.
 *
 * Solo cambia `categoria_servicio.estado`: las solicitudes y servicios en curso
 * de esa categoría no se tocan y siguen hasta cerrarse (SCRUM-858 C3). Las
 * solicitudes nuevas sí la rechazan, porque la creación exige estado ACTIVO
 * (C2, `PgServiceRequestRepository`).
 *
 * Cada cambio queda auditado con quién, cuándo, la decisión y el correlationId
 * (T10 / RNF-04, SCRUM-1391), igual que la verificación de aliados (CA-5 de
 * SCRUM-1066). Sin usuario en la sesión no se hace el cambio, porque no se
 * podría registrar quién lo hizo.
 */
class SetCategoryStatusUseCase {
  constructor({ catalogRepository, auditLogger = (entry) => console.info(JSON.stringify(entry)), now = () => new Date() }) {
    if (!catalogRepository) {
      throw new Error('catalogRepository es requerido para SetCategoryStatusUseCase');
    }
    this.catalogRepository = catalogRepository;
    this.auditLogger = auditLogger;
    this.now = now;
  }

  async execute({ tenantId, categoryId, active, userId, correlationId = 'none' } = {}) {
    if (!tenantId || typeof tenantId !== 'string') {
      throw new ValidationError('tenantId es requerido');
    }
    if (!categoryId || typeof categoryId !== 'string') {
      throw new ValidationError('categoryId es requerido');
    }
    if (typeof active !== 'boolean') {
      throw new ValidationError('active es requerido y debe ser booleano');
    }
    if (!userId || typeof userId !== 'string') {
      throw new UnauthorizedError('La sesión no trae el usuario que hace el cambio', 'UNAUTHORIZED');
    }

    const category = await this.catalogRepository.setActive(tenantId, categoryId, active);
    if (!category) {
      throw new NotFoundError(`No se encontró la categoría ${categoryId} para este tenant`, 'CATEGORY_NOT_FOUND');
    }

    // T10 (RNF-04): quién, cuándo, la decisión y el correlationId, sin PII.
    this.auditLogger({
      event: 'US-03.1.2.cambiar_estado_categoria',
      tenant_id: tenantId,
      categoria_id: categoryId,
      decision: active ? 'ACTIVAR' : 'DESACTIVAR',
      estado_resultante: active ? 'ACTIVO' : 'INACTIVO',
      realizado_por: userId,
      fecha: this.now().toISOString(),
      correlation_id: correlationId,
    });

    return category.toJSON();
  }
}

module.exports = SetCategoryStatusUseCase;
