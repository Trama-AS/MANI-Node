const ICatalogRepository = require('../../domain/ports/ICatalogRepository');
const Category = require('../../domain/entities/Category');

class InMemoryCatalogRepository extends ICatalogRepository {
  constructor() {
    super();
    this.categories = [
      new Category({ id: 'cat-1', name: 'Manicura Tradicional', active: true }),
      new Category({ id: 'cat-2', name: 'Semipermanente', active: true }),
      new Category({ id: 'cat-3', name: 'Uñas Acrílicas / Gel', active: true }),
      // UUIDs del dropdown de MANI-Flutter (registro_aliado_page.dart), para que
      // DEV local sin Supabase acepte lo que la UI realmente envía.
      new Category({ id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a18', name: 'Plomería y Redes Hidráulicas', active: true }),
      new Category({ id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a19', name: 'Electricidad Residencial', active: true }),
      new Category({ id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a20', name: 'Cerrajería y Seguridad', active: true }),
    ];
  }

  async findAllCategories() {
    return [...this.categories];
  }

  async findById(_tenantId, categoryId) {
    return this.categories.find((c) => c.id === categoryId) || null;
  }
}

module.exports = InMemoryCatalogRepository;

