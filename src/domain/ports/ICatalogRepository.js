/**
 * Interfaz / Puerto de Dominio para persistencia del Catálogo.
 */
class ICatalogRepository {
  async findAllCategories() {
    throw new Error('Método findAllCategories() no implementado en ICatalogRepository');
  }

  /** Categorías ACTIVO de un tenant, ordenadas por nombre. Nunca devuelve las de otro tenant. */
  async findActiveByTenant(_tenantId) {
    throw new Error('Método findActiveByTenant() no implementado en ICatalogRepository');
  }

  async findById(_tenantId, _categoryId) {
    throw new Error('Método findById() no implementado en ICatalogRepository');
  }
}

module.exports = ICatalogRepository;

