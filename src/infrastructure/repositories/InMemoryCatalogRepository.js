const crypto = require('node:crypto');
const ICatalogRepository = require('../../domain/ports/ICatalogRepository');
const Category = require('../../domain/entities/Category');
const { ConflictError } = require('../../domain/errors/DomainError');

function normalizeName(name) {
  return String(name).trim().replace(/\s+/g, ' ').toLowerCase();
}

class InMemoryCatalogRepository extends ICatalogRepository {
  constructor() {
    super();
    // tenantId: null = fixture global de desarrollo, visible para cualquier
    // tenant (igual que antes de US-03.1.1-M2.1); las categorías creadas vía
    // el CRUD de Backoffice llevan un tenantId real y quedan aisladas a él.
    this.categories = [
      new Category({ id: 'cat-1', name: 'Manicura Tradicional', active: true, tenantId: null, flujoOperativo: 'TARIFA_ESTANDAR' }),
      new Category({ id: 'cat-2', name: 'Semipermanente', active: true, tenantId: null, flujoOperativo: 'TARIFA_ESTANDAR' }),
      new Category({ id: 'cat-3', name: 'Uñas Acrílicas / Gel', active: true, tenantId: null, flujoOperativo: 'TARIFA_ESTANDAR' }),
      // UUIDs del dropdown de MANI-Flutter (registro_aliado_page.dart), para que
      // DEV local sin Supabase acepte lo que la UI realmente envía.
      new Category({
        id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a18',
        name: 'Plomería y Redes Hidráulicas',
        active: true,
        tenantId: null,
        flujoOperativo: 'COTIZACION_PREVIA',
      }),
      new Category({
        id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a19',
        name: 'Electricidad Residencial',
        active: true,
        tenantId: null,
        flujoOperativo: 'COTIZACION_PREVIA',
      }),
      new Category({
        id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a20',
        name: 'Cerrajería y Seguridad',
        active: true,
        tenantId: null,
        flujoOperativo: 'COTIZACION_PREVIA',
      }),
    ];
  }

  async findAllCategories() {
    return [...this.categories];
  }

  async findById(tenantId, categoryId) {
    return (
      this.categories.find((c) => c.id === categoryId && (c.tenantId === null || c.tenantId === tenantId)) || null
    );
  }

  async findAllByTenant(tenantId, { onlyActive = false } = {}) {
    return this.categories.filter((c) => c.tenantId === tenantId && (!onlyActive || c.isActive()));
  }

  _assertNameNotDuplicated(tenantId, name, excludeId = null) {
    const normalized = normalizeName(name);
    const exists = this.categories.some(
      (c) => c.tenantId === tenantId && c.id !== excludeId && normalizeName(c.name) === normalized
    );
    if (exists) {
      throw new ConflictError(
        `Ya existe una categoría con el nombre "${String(name).trim()}" en este tenant`,
        'CATEGORY_NAME_ALREADY_EXISTS'
      );
    }
  }

  async create(tenantId, { name, description, flujoOperativo }) {
    this._assertNameNotDuplicated(tenantId, name);
    const category = new Category({ id: crypto.randomUUID(), name, description, active: true, tenantId, flujoOperativo });
    this.categories.push(category);
    return category;
  }

  async update(tenantId, categoryId, { name, description, flujoOperativo }) {
    const index = this.categories.findIndex((c) => c.id === categoryId && c.tenantId === tenantId);
    if (index === -1) return null;

    if (name !== undefined) {
      this._assertNameNotDuplicated(tenantId, name, categoryId);
    }

    const current = this.categories[index];
    const updated = new Category({
      id: current.id,
      name: name !== undefined ? name : current.name,
      description: description !== undefined ? description : current.description,
      active: current.active,
      tenantId: current.tenantId,
      flujoOperativo: flujoOperativo !== undefined ? flujoOperativo : current.flujoOperativo,
    });
    this.categories[index] = updated;
    return updated;
  }

  async setActive(tenantId, categoryId, active) {
    const index = this.categories.findIndex((c) => c.id === categoryId && c.tenantId === tenantId);
    if (index === -1) return null;

    const current = this.categories[index];
    const updated = new Category({ ...current, active });
    this.categories[index] = updated;
    return updated;
  }
}

module.exports = InMemoryCatalogRepository;
