const { NotFoundError } = require('../../../domain/errors/DomainError');
const { buildHierarchy, requireZoneUuid, requireZoneLevel } = require('./zoneHierarchy');

/**
 * Consulta del catálogo geográfico (HU-M04-04 / REST-01).
 *
 * `zona` es un catálogo global sin tenant_id, así que el caso de uso no
 * recibe tenantId ni filtra por él: el aislamiento del criterio C3 lo da el
 * borde HTTP, que exige un JWT verificado y toma el tenant del claim. Si en
 * algún momento las zonas pasan a ser privadas por tenant, eso es una
 * migración con tenant_id y RLS en el mismo cambio (criterio T3), no un
 * filtro añadido acá.
 */
class ListZoneCatalogUseCase {
  constructor({ zoneRepository }) {
    if (!zoneRepository) {
      throw new Error('zoneRepository es requerido para ListZoneCatalogUseCase');
    }
    this.zoneRepository = zoneRepository;
  }

  /**
   * @param {object} [input]
   * @param {boolean} [input.onlyActive] deja fuera las zonas desactivadas.
   * @param {string} [input.level] recorta a un nivel de la jerarquía.
   * @param {string} [input.parentId] recorta a los descendientes de una zona.
   */
  async execute({ onlyActive = false, level = null, parentId = null } = {}) {
    const requestedLevel = level === null || level === undefined ? null : requireZoneLevel(level);
    const requestedParentId = parentId === null || parentId === undefined ? null : requireZoneUuid(parentId, 'parentId');

    // La jerarquía se arma con el catálogo completo (respetando onlyActive)
    // para que una zona cuyo padre queda fuera del recorte no parezca
    // huérfana: los recortes se aplican después de validar las relaciones.
    const zones = await this.zoneRepository.findAll({ onlyActive });

    if (requestedParentId) {
      // Un parentId que no existe es un error del contrato, no una lista
      // vacía: C2 pide rechazar la relación inválida.
      const parent = zones.find((z) => z.id === requestedParentId)
        ?? (await this.zoneRepository.findById(requestedParentId));
      if (!parent) {
        throw new NotFoundError('MANI-ZON-404: la zona padre no existe', 'MANI-ZON-404');
      }
    }

    const { inconsistencies } = buildHierarchy(zones);
    const inconsistentIds = new Set(inconsistencies.map((i) => i.id));

    const selected = zones.filter((zone) => {
      if (inconsistentIds.has(zone.id)) return false;
      if (requestedLevel && zone.level !== requestedLevel) return false;
      if (requestedParentId && !isDescendantOf(zone, requestedParentId, zones)) return false;
      return true;
    });

    const { tree } = buildHierarchy(selected);

    return {
      zones: selected.map((z) => z.toJSON()),
      tree,
      // Se reportan para que un dato malo en la base sea visible en lugar de
      // quedar colgado en un lugar inventado del árbol.
      inconsistencies,
    };
  }
}

// Recorre hacia la raíz por parentId. El tope de saltos evita un ciclo en la
// base (la columna es auto-referenciada y nada impide A->B->A).
function isDescendantOf(zone, ancestorId, zones) {
  const byId = new Map(zones.map((z) => [z.id, z]));
  let current = zone;
  for (let hops = 0; hops < zones.length; hops += 1) {
    if (!current.parentId) return false;
    if (current.parentId === ancestorId) return true;
    current = byId.get(current.parentId);
    if (!current) return false;
  }
  return false;
}

module.exports = ListZoneCatalogUseCase;
