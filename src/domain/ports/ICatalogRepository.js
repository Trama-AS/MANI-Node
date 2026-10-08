/**
 * Interfaz / Puerto de Dominio para persistencia del Catálogo.
 */
class ICatalogRepository {
  /** Listado público/global (vitrina de registro, sin autenticar). */
  async findAllCategories() {
    throw new Error('Método findAllCategories() no implementado en ICatalogRepository');
  }

  async findById(_tenantId, _categoryId) {
    throw new Error('Método findById() no implementado en ICatalogRepository');
  }

  /** Listado de gestión (Backoffice), aislado por tenant (US-03.1.1-M2.1). */
  async findAllByTenant(_tenantId, _options) {
    throw new Error('Método findAllByTenant() no implementado en ICatalogRepository');
  }

  async create(_tenantId, _data) {
    throw new Error('Método create() no implementado en ICatalogRepository');
  }

  /** @returns {Promise<object|null>} null si la categoría no existe o no pertenece al tenant. */
  async update(_tenantId, _categoryId, _data) {
    throw new Error('Método update() no implementado en ICatalogRepository');
  }

  /** Transición del flujo operativo (activar/desactivar), sin borrado físico. */
  async setActive(_tenantId, _categoryId, _active) {
    throw new Error('Método setActive() no implementado en ICatalogRepository');
  }
}

module.exports = ICatalogRepository;

