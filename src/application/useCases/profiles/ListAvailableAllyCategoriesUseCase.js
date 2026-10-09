const { DomainError } = require('../../../domain/errors/DomainError');

/**
 * Categorías que un aliado puede elegir: solo las ACTIVO de SU tenant.
 * Porta `listar_categorias_tenant` (database/migrations/004_aliado_categorias.sql,
 * hoy en MANI-APIGateway) al servicio (ADR-0022). A diferencia de GET /catalog,
 * el tenant sale del JWT verificado y nunca de la petición.
 */
class ListAvailableAllyCategoriesUseCase {
  constructor({ aliadoRepository, catalogRepository }) {
    if (!aliadoRepository) {
      throw new Error('aliadoRepository es requerido para ListAvailableAllyCategoriesUseCase');
    }
    if (!catalogRepository) {
      throw new Error('catalogRepository es requerido para ListAvailableAllyCategoriesUseCase');
    }
    this.aliadoRepository = aliadoRepository;
    this.catalogRepository = catalogRepository;
  }

  async execute({ userId, tenantId, role } = {}) {
    if (!userId || !tenantId) {
      throw new DomainError('MANI-CAT-401: sesión requerida', 'MANI-CAT-401', 401);
    }

    if (role !== 'ALLY') {
      throw new DomainError('MANI-CAT-403: solo un aliado activo puede consultar categorías', 'MANI-CAT-403', 403);
    }

    const aliado = await this.aliadoRepository.findByUsuarioId(tenantId, userId);
    if (!aliado) {
      throw new DomainError('MANI-CAT-403: solo un aliado activo puede consultar categorías', 'MANI-CAT-403', 403);
    }

    const categories = await this.catalogRepository.findActiveByTenant(tenantId);
    return categories.map((c) => ({ id: c.id, name: c.name }));
  }
}

module.exports = ListAvailableAllyCategoriesUseCase;
