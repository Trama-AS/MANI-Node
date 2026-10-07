const { ValidationError } = require('../errors/DomainError');

const NAME_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 500;

class Category {
  // tenantId = null identifica las categorías "globales" de las fixtures de
  // desarrollo (compartidas por cualquier tenant en DEV/test); toda categoría
  // creada vía el CRUD de Backoffice (US-03.1.1-M2.1) lleva un tenantId real.
  constructor({ id, name, active = true, description = '', tenantId = null }) {
    if (!id || typeof id !== 'string') {
      throw new ValidationError('Category id es requerido');
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new ValidationError('Category name es requerido');
    }
    if (name.trim().length > NAME_MAX_LENGTH) {
      throw new ValidationError(`Category name no puede superar los ${NAME_MAX_LENGTH} caracteres`);
    }
    if (description && description.length > DESCRIPTION_MAX_LENGTH) {
      throw new ValidationError(`Category description no puede superar los ${DESCRIPTION_MAX_LENGTH} caracteres`);
    }

    this.id = id;
    this.name = name.trim();
    this.active = Boolean(active);
    this.description = description || '';
    this.tenantId = tenantId;
  }

  isActive() {
    return this.active;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      active: this.active,
      description: this.description,
      tenantId: this.tenantId,
    };
  }
}

module.exports = Category;

