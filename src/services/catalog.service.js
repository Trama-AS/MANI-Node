const container = require('../container');

/**
 * Servicio de Catálogo (Fachada hacia ListCatalogCategoriesUseCase para compatibilidad)
 */
async function listCategories() {
  return container.listCatalogCategoriesUseCase.execute();
}

module.exports = { listCategories };

