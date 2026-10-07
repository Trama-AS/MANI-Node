/**
 * Interfaz / Puerto de Dominio para persistencia del Catálogo.
 */
class ICatalogRepository {
  async findAllCategories() {
    throw new Error('Método findAllCategories() no implementado en ICatalogRepository');
  }
}

module.exports = ICatalogRepository;

