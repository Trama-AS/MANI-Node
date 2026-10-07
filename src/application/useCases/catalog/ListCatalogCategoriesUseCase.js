class ListCatalogCategoriesUseCase {
  constructor({ catalogRepository }) {
    if (!catalogRepository) {
      throw new Error('catalogRepository es requerido para ListCatalogCategoriesUseCase');
    }
    this.catalogRepository = catalogRepository;
  }

  async execute({ onlyActive = false } = {}) {
    const categories = await this.catalogRepository.findAllCategories();
    const filtered = onlyActive
      ? categories.filter((c) => (typeof c.isActive === 'function' ? c.isActive() : c.active !== false))
      : categories;

    return filtered.map((c) => (typeof c.toJSON === 'function' ? c.toJSON() : c));
  }
}

module.exports = ListCatalogCategoriesUseCase;

