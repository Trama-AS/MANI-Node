const { DomainError } = require('../../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Mismo tope que mostraba la app (CoberturaFailure.maxZonas): se declara la localidad completa, no barrio por barrio.
const MAX_ZONAS = 200;

/**
 * Reemplaza el conjunto de zonas que cubre el aliado de la sesión (PUT idempotente: repetirlo deja el mismo estado).
 * Reglas de `declarar_cobertura`: selección no vacía (422V), a lo sumo 200 zonas (422L) y todas existentes y activas
 * (422Z; un id inexistente responde igual que uno desactivado).
 */
class DeclareAllyCoverageUseCase {
  constructor({ coberturaRepository }) {
    if (!coberturaRepository) throw new Error('coberturaRepository es requerido para DeclareAllyCoverageUseCase');
    this.coberturaRepository = coberturaRepository;
  }

  async execute({ user, zoneIds } = {}) {
    if (!user?.userId || !user?.tenantId) throw new DomainError('MANI-COB-401: sesión requerida', 'MANI-COB-401', 401);
    if (user.role !== 'ALLY') {
      throw new DomainError('MANI-COB-403: solo un aliado activo puede declarar cobertura', 'MANI-COB-403', 403);
    }
    if (!Array.isArray(zoneIds)) {
      throw new DomainError('MANI-COB-422V: selecciona al menos una zona', 'MANI-COB-422V', 422);
    }
    const ids = [...new Set(zoneIds.filter((id) => typeof id === 'string' && id.trim() !== '').map((id) => id.trim()))];
    if (ids.length === 0) throw new DomainError('MANI-COB-422V: selecciona al menos una zona', 'MANI-COB-422V', 422);
    if (ids.length > MAX_ZONAS) {
      throw new DomainError(`MANI-COB-422L: máximo ${MAX_ZONAS} zonas por declaración`, 'MANI-COB-422L', 422);
    }
    if (ids.some((id) => !UUID_RE.test(id))) {
      throw new DomainError('MANI-COB-422Z: una o más zonas no están disponibles', 'MANI-COB-422Z', 422);
    }
    const zones = await this.coberturaRepository.declarar(
      { tenantId: user.tenantId, userId: user.userId, role: user.role },
      ids
    );
    return { zones, zoneIds: zones.map((z) => z.id) };
  }
}

module.exports = DeclareAllyCoverageUseCase;
module.exports.MAX_ZONAS = MAX_ZONAS;
