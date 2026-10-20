const { ValidationError } = require('../errors/DomainError');

const DESCRIPTION_MAX_LENGTH = 500;

function normalizeName(name) {
  return name.trim().replace(/\s+/g, ' ');
}

class Category {
  // tenantId = null identifica las categorías "globales" de las fixtures de
  // desarrollo (compartidas por cualquier tenant en DEV/test); toda categoría
  // creada vía el CRUD de Backoffice (US-03.1.1-M2.1) lleva un tenantId real.
  //
  // Las reglas operativas (longitud y letras del nombre, flujos permitidos)
  // NO viven aquí ni en Core: las decide el Rules Service antes de crear o
  // editar (US-03.1.1-M6). La entidad solo exige la forma mínima, así que
  // rehidratar filas históricas (flujo_operativo NULL del seed QA, o un nombre
  // fuera de las reglas actuales) nunca rompe un listado.
  constructor({ id, name, active = true, description = '', tenantId = null, flujoOperativo = null }) {
    if (!id || typeof id !== 'string') {
      throw new ValidationError('Category id es requerido');
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new ValidationError('Category name es requerido');
    }
    if (description && description.length > DESCRIPTION_MAX_LENGTH) {
      throw new ValidationError(`Category description no puede superar los ${DESCRIPTION_MAX_LENGTH} caracteres`);
    }

    this.id = id;
    this.name = normalizeName(name);
    this.active = Boolean(active);
    this.description = description || '';
    this.tenantId = tenantId;
    this.flujoOperativo = flujoOperativo;
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
      flujoOperativo: this.flujoOperativo,
    };
  }
}

module.exports = Category;
