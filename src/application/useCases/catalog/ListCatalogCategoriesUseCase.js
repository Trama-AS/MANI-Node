class ListCatalogCategoriesUseCase {
  constructor({ catalogRepository }) {
    if (!catalogRepository) {
      throw new Error('catalogRepository es requerido para ListCatalogCategoriesUseCase');
    }
    this.catalogRepository = catalogRepository;
  }

  // tenantId resuelto desde X-Tenant-Slug por el controller (vitrina
  // pre-auth, no hay JWT todavía). Nunca se listan categorías de OTRO
  // tenant: solo las globales de fixtures (tenantId null) más, si el
  // caller manda un tenant resuelto, las propias de ese tenant.
  async execute({ onlyActive = false, tenantId = null } = {}) {
    const categories = await this.catalogRepository.findAllCategories();
    const visible = categories.filter((c) => c.tenantId === null || c.tenantId === tenantId);
    const filtered = onlyActive
      ? visible.filter((c) => (typeof c.isActive === 'function' ? c.isActive() : c.active !== false))
      : visible;

    return filtered.map((c) => (typeof c.toJSON === 'function' ? c.toJSON() : c));
  }
}

module.exports = ListCatalogCategoriesUseCase;

