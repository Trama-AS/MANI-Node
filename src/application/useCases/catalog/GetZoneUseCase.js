const { NotFoundError } = require('../../../domain/errors/DomainError');
const { requireZoneUuid } = require('./zoneHierarchy');

/**
 * Una zona del catálogo con su camino hasta la raíz y sus hijos directos
 * (HU-M04-04, C1: identificadores estables y jerarquía consultable).
 *
 * Devuelve también las zonas desactivadas: un sitio histórico puede apuntar a
 * una de ellas y ocultarla rompería esa consulta. El campo `selectable` de
 * cada zona dice si puede escogerse, que es lo que pide C2.
 */
class GetZoneUseCase {
  constructor({ zoneRepository }) {
    if (!zoneRepository) {
      throw new Error('zoneRepository es requerido para GetZoneUseCase');
    }
    this.zoneRepository = zoneRepository;
  }

  async execute({ zoneId } = {}) {
    requireZoneUuid(zoneId, 'id de la zona');

    const zone = await this.zoneRepository.findById(zoneId);
    if (!zone) {
      throw new NotFoundError('MANI-ZON-404: la zona no existe', 'MANI-ZON-404');
    }

    const all = await this.zoneRepository.findAll({});
    const byId = new Map(all.map((z) => [z.id, z]));

    return {
      zone: zone.toJSON(),
      // De la raíz hacia la zona, para que la interfaz pueda mostrar el
      // camino completo sin recalcularlo.
      ancestors: ancestorsOf(zone, byId).map((z) => z.toJSON()),
      children: all.filter((z) => z.parentId === zone.id).map((z) => z.toJSON()),
    };
  }
}

function ancestorsOf(zone, byId) {
  const path = [];
  let current = zone;
  // Tope de saltos: la columna es auto-referenciada y la base no impide un
  // ciclo, así que no se recorre más que el tamaño del catálogo.
  for (let hops = 0; hops < byId.size; hops += 1) {
    if (!current.parentId) break;
    const parent = byId.get(current.parentId);
    if (!parent || parent.id === current.id) break;
    path.unshift(parent);
    current = parent;
  }
  return path;
}

module.exports = GetZoneUseCase;
