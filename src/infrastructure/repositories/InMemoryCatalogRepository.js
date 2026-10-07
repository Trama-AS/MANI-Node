const ICatalogRepository = require('../../domain/ports/ICatalogRepository');
const Category = require('../../domain/entities/Category');

class InMemoryCatalogRepository extends ICatalogRepository {
  constructor() {
    super();
    this.categories = [
      new Category({ id: 'cat-1', name: 'Manicura Tradicional', active: true }),
      new Category({ id: 'cat-2', name: 'Semipermanente', active: true }),
      new Category({ id: 'cat-3', name: 'Uñas Acrílicas / Gel', active: true }),
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

