class ListCatalogCategoriesUseCase {
  constructor({ catalogRepository }) {
    if (!catalogRepository) {
      throw new Error('catalogRepository es requerido para ListCatalogCategoriesUseCase');
    }
    this.catalogRepository = catalogRepository;
  }

  // Vitrina pre-auth: tenantId lo resuelve el controller desde X-Tenant-Slug.
  // Sin tenant no hay a quién mostrarle categorías, así que no se consulta
  // nada (nunca se listan las de otros tenants). Con tenant, el filtro por
  // tenant_id y estado ACTIVO va en la consulta, no en memoria.
  async execute({ tenantId = null } = {}) {
    if (!tenantId) {
      return [];
    }
    const categories = await this.catalogRepository.findActiveByTenant(tenantId);
    return categories.map((c) => (typeof c.toJSON === 'function' ? c.toJSON() : c));
  }
}

module.exports = ListCatalogCategoriesUseCase;
