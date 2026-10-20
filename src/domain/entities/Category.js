const { ValidationError } = require('../errors/DomainError');

const NAME_MIN_LENGTH = 3;
const NAME_MAX_LENGTH = 60;
const DESCRIPTION_MAX_LENGTH = 500;
// Debe contener al menos una letra (cualquier idioma); NO se exige que sea
// *solo* letras. Mismo criterio que crear_categoria_servicio() en
// MANI-APIGateway/database/migrations/003_categorias_servicio.sql
// (`v_nombre !~ '[[:alpha:]]'`).
const NAME_HAS_LETTER_PATTERN = /\p{L}/u;

// Flujo operativo de la categoría (US-03.1.1-M2.1 / migración 003):
//   COTIZACION_PREVIA  el aliado diagnostica y cotiza antes de ejecutar.
//   TARIFA_ESTANDAR    se cobra la tarifa de referencia del tenant, sin
//                      cotización previa.
const VALID_FLUJO_OPERATIVO = ['COTIZACION_PREVIA', 'TARIFA_ESTANDAR'];

function normalizeName(name) {
  return name.trim().replace(/\s+/g, ' ');
}

class Category {
  // tenantId = null identifica las categorías "globales" de las fixtures de
  // desarrollo; toda categoría creada vía el CRUD de Backoffice lleva un
  // tenantId real.
  //
  // El constructor solo exige la forma mínima, porque también rehidrata filas
  // existentes: filas históricas (seed QA con flujo_operativo NULL, columna
  // NOT VALID) o con un nombre fuera de las reglas actuales deben poder
  // leerse sin romper todo el listado. Las reglas de negocio se aplican a los
  // datos NUEVOS, en CreateCategoryUseCase/UpdateCategoryUseCase, mediante
  // assertValidName/assertValidFlujoOperativo.
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

  /** Reglas del nombre para datos nuevos; devuelve el nombre normalizado. */
  static assertValidName(name) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new ValidationError('name es requerido');
    }
    const normalized = normalizeName(name);
    if (normalized.length < NAME_MIN_LENGTH || normalized.length > NAME_MAX_LENGTH) {
      throw new ValidationError(`name debe tener entre ${NAME_MIN_LENGTH} y ${NAME_MAX_LENGTH} caracteres`);
    }
    if (!NAME_HAS_LETTER_PATTERN.test(normalized)) {
      throw new ValidationError('name debe contener al menos una letra');
    }
    return normalized;
  }

  /** Reglas del flujo operativo para datos nuevos (obligatorio, sin default). */
  static assertValidFlujoOperativo(flujoOperativo) {
    if (!VALID_FLUJO_OPERATIVO.includes(flujoOperativo)) {
      throw new ValidationError(
        `flujoOperativo inválido: "${flujoOperativo}". Valores permitidos: ${VALID_FLUJO_OPERATIVO.join(', ')}`
      );
    }
    return flujoOperativo;
  }
}

Category.VALID_FLUJO_OPERATIVO = VALID_FLUJO_OPERATIVO;

module.exports = Category;
