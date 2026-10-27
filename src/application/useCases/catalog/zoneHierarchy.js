const { ValidationError } = require('../../../domain/errors/DomainError');
const { LEVELS } = require('../../../domain/entities/Zone');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireZoneUuid(value, field) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new ValidationError(`MANI-ZON-400: ${field} debe ser un UUID válido`, 'MANI-ZON-400');
  }
  return value;
}

// El nivel llega como filtro de consulta, así que se valida contra la lista
// prevista: un nivel desconocido es un error de contrato, no un listado vacío
// (C2 exige rechazar, no responder como si no hubiera datos).
function requireZoneLevel(value) {
  const level = String(value).trim().toUpperCase();
  if (!LEVELS.includes(level)) {
    throw new ValidationError(
      `MANI-ZON-400: nivel debe ser uno de ${LEVELS.join(', ')}`,
      'MANI-ZON-400'
    );
  }
  return level;
}

/**
 * Arma la jerarquía a partir del listado plano y separa las filas que no
 * pueden colocarse en el árbol.
 *
 * No se inventa estructura: una fila cuyo padre no existe, o cuya relación
 * contradice el orden de niveles, queda FUERA del árbol y se reporta en
 * `inconsistencies`. Colgarla de la raíz la mostraría como una zona de primer
 * nivel que no es, y descartarla en silencio esconde un dato malo de la base.
 *
 * @param {import('../../../domain/entities/Zone')[]} zones
 * @returns {{ tree: object[], inconsistencies: object[] }}
 */
function buildHierarchy(zones) {
  const byId = new Map(zones.map((z) => [z.id, z]));
  const inconsistencies = [];
  const placeable = [];

  for (const zone of zones) {
    const reason = inconsistencyOf(zone, byId);
    if (reason) {
      inconsistencies.push({ id: zone.id, level: zone.level, parentId: zone.parentId, reason });
    } else {
      placeable.push(zone);
    }
  }

  const nodes = new Map(placeable.map((z) => [z.id, { ...z.toJSON(), children: [] }]));
  const tree = [];
  for (const zone of placeable) {
    const node = nodes.get(zone.id);
    // Un padre filtrado por `onlyActive` o por `nivel` no está en `nodes`: el
    // hijo sube a la raíz del resultado conservando su parentId, porque el
    // recorte lo pidió quien consulta y no es un dato inconsistente.
    const parent = zone.parentId ? nodes.get(zone.parentId) : null;
    if (parent) {
      parent.children.push(node);
    } else {
      tree.push(node);
    }
  }

  return { tree, inconsistencies };
}

function inconsistencyOf(zone, byId) {
  const depth = zone.depth();
  if (zone.isRoot()) {
    // Solo el nivel más alto previsto puede no tener padre. Un BARRIO o una
    // LOCALIDAD sin zona padre es el caso huérfano de C2.
    return depth > 0 ? 'ZONA_SIN_PADRE' : null;
  }
  const parent = byId.get(zone.parentId);
  if (!parent) {
    return 'PADRE_INEXISTENTE';
  }
  if (parent.id === zone.id) {
    return 'PADRE_ES_LA_MISMA_ZONA';
  }
  const parentDepth = parent.depth();
  // -1 = nivel fuera de LEVELS (fila histórica): no hay con qué comparar
  // profundidades, así que la relación no se declara inválida.
  if (depth >= 0 && parentDepth >= 0 && depth <= parentDepth) {
    return 'RELACION_DE_NIVEL_INVERTIDA';
  }
  return null;
}

module.exports = { buildHierarchy, requireZoneUuid, requireZoneLevel };
