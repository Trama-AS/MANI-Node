const { ValidationError } = require('../errors/DomainError');

class Tenant {
  constructor({ id, name, slug, status = 'ACTIVE', createdAt = new Date() }) {
    if (!id || typeof id !== 'string') {
      throw new ValidationError('Tenant id es requerido y debe ser una cadena');
    }
    if (!name || typeof name !== 'string') {
      throw new ValidationError('Tenant name es requerido y debe ser una cadena');
    }

    this.id = id;
    this.name = name;
    this.slug = slug || id;
    this.status = status;
    this.createdAt = createdAt;
  }

  isActive() {
    return this.status === 'ACTIVE';
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      slug: this.slug,
      status: this.status,
    };
  }
}

module.exports = Tenant;

