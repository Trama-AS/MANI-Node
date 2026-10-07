const { DomainError } = require('../../../domain/errors/DomainError');

class GetAllyCategoriesUseCase {
  constructor({ aliadoRepository, aliadoCategoriaRepository }) {
    if (!aliadoRepository) {
      throw new Error('aliadoRepository es requerido para GetAllyCategoriesUseCase');
    }
    if (!aliadoCategoriaRepository) {
      throw new Error('aliadoCategoriaRepository es requerido para GetAllyCategoriesUseCase');
    }
    this.aliadoRepository = aliadoRepository;
    this.aliadoCategoriaRepository = aliadoCategoriaRepository;
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

    const aliadoId = aliado.id || aliado.usuarioId || userId;
    const categoryIds = await this.aliadoCategoriaRepository.findByAliadoId(tenantId, aliadoId);
    return categoryIds;
  }
}

module.exports = GetAllyCategoriesUseCase;
