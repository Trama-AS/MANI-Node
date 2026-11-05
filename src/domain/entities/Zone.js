const { ValidationError } = require('../errors/DomainError');

// Niveles de la jerarquía geográfica del MVP, de mayor a menor granularidad.
// El orden importa: define la profundidad esperada de un nivel respecto a su
// padre y permite rechazar relaciones invertidas (una CIUDAD colgada de una
// LOCALIDAD). BARRIO es el nivel más fino previsto (HU-M04-06): la columna
// `zona.nivel` es TEXT, así que añadirlo no necesita migración de esquema.
const LEVELS = ['CIUDAD', 'LOCALIDAD', 'BARRIO'];

function normalizeName(name) {
  return name.trim().replace(/\s+/g, ' ');
}

class Zone {
  // `zona` es un catálogo global: no tiene columna tenant_id (ver
  // MANI-APIGateway/database/init/01-schema.sql). La entidad no lleva
  // tenantId porque no hay zona privada de un tenant; el aislamiento del
  // criterio C3 se cumple derivando tenant y rol del claim del JWT en el
  // borde y no aceptando nunca un tenant enviado por el cliente.
  //
  // Se rehidratan filas históricas sin validar el nivel contra LEVELS: el
  // seed de QA trae CIUDAD y LOCALIDAD, pero una fila con otro nivel no debe
  // romper un listado. Las relaciones sí se validan al construir la jerarquía.
  constructor({ id, name, level, parentId = null, active = true }) {
    if (!id || typeof id !== 'string') {
      throw new ValidationError('Zone id es requerido');
    }
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new ValidationError('Zone name es requerido');
    }
    if (!level || typeof level !== 'string' || !level.trim()) {
      throw new ValidationError('Zone level es requerido');
    }

    this.id = id;
    this.name = normalizeName(name);
    this.level = level.trim().toUpperCase();
    this.parentId = parentId || null;
    this.active = Boolean(active);
  }

  isActive() {
    return this.active;
  }

  isRoot() {
    return this.parentId === null;
  }

  // Posición en LEVELS, o -1 si el nivel no es uno de los previstos (fila
  // histórica): quien compare profundidades debe tratar -1 como desconocido.
  depth() {
    return LEVELS.indexOf(this.level);
  }

  toJSON() {
    return {
      id: this.id,
      name: this.name,
      level: this.level,
      parentId: this.parentId,
      active: this.active,
      // Una zona inactiva sigue siendo consultable (un sitio histórico puede
      // apuntar a ella) pero no se ofrece para escoger: C2 exige que no
      // vuelva como seleccionable.
      selectable: this.active,
    };
  }
}

module.exports = Zone;
module.exports.LEVELS = LEVELS;
