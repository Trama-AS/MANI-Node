const { DomainError } = require('../../../domain/errors/DomainError');

class DeclareAllyCategoriesUseCase {
  constructor({ aliadoRepository, aliadoCategoriaRepository, catalogRepository }) {
    if (!aliadoRepository) {
      throw new Error('aliadoRepository es requerido para DeclareAllyCategoriesUseCase');
    }
    if (!aliadoCategoriaRepository) {
      throw new Error('aliadoCategoriaRepository es requerido para DeclareAllyCategoriesUseCase');
    }
    if (!catalogRepository) {
      throw new Error('catalogRepository es requerido para DeclareAllyCategoriesUseCase');
    }
    this.aliadoRepository = aliadoRepository;
    this.aliadoCategoriaRepository = aliadoCategoriaRepository;
    this.catalogRepository = catalogRepository;
  }

  async execute({ userId, tenantId, role, categoryIds } = {}) {
    if (!userId || !tenantId) {
      throw new DomainError('MANI-CAT-401: sesión requerida', 'MANI-CAT-401', 401);
    }

    if (role !== 'ALLY') {
      throw new DomainError('MANI-CAT-403: solo un aliado activo puede declarar categorías', 'MANI-CAT-403', 403);
    }

    const aliado = await this.aliadoRepository.findByUsuarioId(tenantId, userId);
    if (!aliado) {
      throw new DomainError('MANI-CAT-403: solo un aliado activo puede declarar categorías', 'MANI-CAT-403', 403);
    }

    if (!categoryIds || !Array.isArray(categoryIds)) {
      throw new DomainError('MANI-CAT-422V: selecciona al menos una categoría', 'MANI-CAT-422V', 422);
    }

    const cleanIds = [
      ...new Set(categoryIds.filter((id) => typeof id === 'string' && id.trim() !== '')),
    ];

    if (cleanIds.length === 0) {
      throw new DomainError('MANI-CAT-422V: selecciona al menos una categoría', 'MANI-CAT-422V', 422);
    }

    for (const catId of cleanIds) {
      const category = await this.catalogRepository.findById(tenantId, catId);
      const isActive =
        category &&
        (typeof category.isActive === 'function' ? category.isActive() : category.active !== false);

      if (!category || !isActive) {
        throw new DomainError('MANI-CAT-422C: categoría no disponible', 'MANI-CAT-422C', 422);
      }
    }

    const aliadoId = aliado.id || aliado.usuarioId || userId;
    const saved = await this.aliadoCategoriaRepository.setAliadoCategorias(tenantId, aliadoId, cleanIds);
    return saved;
  }
}

module.exports = DeclareAllyCategoriesUseCase;
