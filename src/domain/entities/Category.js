const { ValidationError } = require('../errors/DomainError');

const NAME_MIN_LENGTH = 3;
const NAME_MAX_LENGTH = 60;
const DESCRIPTION_MAX_LENGTH = 500;
// Debe contener al menos una letra (cualquier idioma); NO se exige que sea
// *solo* letras. Mismo criterio que crear_categoria_servicio() en
// MANI-APIGateway/database/migrations/003_categorias_servicio.sql
// (`v_nombre !~ '[[:alpha:]]'`), para no divergir entre la RPC de Postgres
// (que valida directamente en BD) y esta validación de Core Node sobre la
// misma tabla `categoria_servicio`.
const NAME_HAS_LETTER_PATTERN = /\p{L}/u;

// Flujo operativo de la categoría (US-03.1.1-M2.1 / migración 003):
//   COTIZACION_PREVIA  el aliado diagnostica y cotiza antes de ejecutar.
//   TARIFA_ESTANDAR    se cobra la tarifa de referencia del tenant, sin
//                      cotización previa.
const VALID_FLUJO_OPERATIVO = ['COTIZACION_PREVIA', 'TARIFA_ESTANDAR'];

class Category {
  // tenantId = null identifica las categorías "globales" de las fixtures de
  // desarrollo (compartidas por cualquier tenant en DEV/test); toda categoría
  // creada vía el CRUD de Backoffice (US-03.1.1-M2.1) lleva un tenantId real.
  // flujoOperativo es OBLIGATORIO (sin default): es un dato de negocio que el
  // Backoffice debe elegir explícitamente, igual que exige la migración 003.
  constructor({ id, name, active = true, description = '', tenantId = null, flujoOperativo }) {
    if (!id || typeof id !== 'string') {
      throw new ValidationError('Category id es requerido');
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new ValidationError('Category name es requerido');
    }
    // Colapsa espacios internos repetidos, igual que crear_categoria_servicio().
    const normalizedName = name.trim().replace(/\s+/g, ' ');
    if (normalizedName.length < NAME_MIN_LENGTH || normalizedName.length > NAME_MAX_LENGTH) {
      throw new ValidationError(`Category name debe tener entre ${NAME_MIN_LENGTH} y ${NAME_MAX_LENGTH} caracteres`);
    }
    if (!NAME_HAS_LETTER_PATTERN.test(normalizedName)) {
      throw new ValidationError('Category name debe contener al menos una letra');
    }
    if (description && description.length > DESCRIPTION_MAX_LENGTH) {
      throw new ValidationError(`Category description no puede superar los ${DESCRIPTION_MAX_LENGTH} caracteres`);
    }
    if (!VALID_FLUJO_OPERATIVO.includes(flujoOperativo)) {
      throw new ValidationError(
        `flujoOperativo inválido: "${flujoOperativo}". Valores permitidos: ${VALID_FLUJO_OPERATIVO.join(', ')}`
      );
    }

    this.id = id;
    this.name = normalizedName;
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

Category.VALID_FLUJO_OPERATIVO = VALID_FLUJO_OPERATIVO;

module.exports = Category;

