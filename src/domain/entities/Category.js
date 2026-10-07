const { ValidationError } = require('../errors/DomainError');

class Category {
  constructor({ id, name, active = true, description = '' }) {
    if (!id || typeof id !== 'string') {
      throw new ValidationError('Category id es requerido');
    }
    if (!name || typeof name !== 'string') {
      throw new ValidationError('Category name es requerido');
    }

    this.id = id;
    this.name = name;
    this.active = Boolean(active);
    this.description = description;
  }

  isActive() {
    return this.active;
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      active: this.active,
    };
  }
}

module.exports = Category;

