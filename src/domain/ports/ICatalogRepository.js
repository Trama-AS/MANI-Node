/**
 * Interfaz / Puerto de Dominio para persistencia del Catálogo.
 */
class ICatalogRepository {
  async findAllCategories() {
    throw new Error('Método findAllCategories() no implementado en ICatalogRepository');
  }

  async findById(_tenantId, _categoryId) {
    throw new Error('Método findById() no implementado en ICatalogRepository');
  }
}

module.exports = ICatalogRepository;

