const { ForbiddenError } = require('../../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Bandeja del aliado (SCRUM-1402/1404) para Dispatch: las solicitudes que tiene asignadas y las PENDIENTE para
 * las que recibió una oferta. Dispatch le quita las que el aliado rechazó (los rechazos son suyos, T1) y la
 * expone en GET /dispatch/offers/me. Reemplaza a la RPC 005 `listar_solicitudes_aliado`.
 */
class ListAllyOffersUseCase {
  constructor({ solicitudAsignacionRepository }) {
    if (!solicitudAsignacionRepository) throw new Error('solicitudAsignacionRepository es requerido para ListAllyOffersUseCase');
    this.solicitudAsignacionRepository = solicitudAsignacionRepository;
  }

  async execute({ session = {} } = {}) {
    const { tenantId, userId, role } = session;
    if (!tenantId || role !== 'ALLY' || !UUID_RE.test(String(userId || ''))) {
      throw new ForbiddenError('MANI-DSP-403: solo un aliado autenticado consulta su bandeja de ofertas', 'MANI-DSP-403');
    }
    return this.solicitudAsignacionRepository.ofertasDelAliado({ tenantId, userId, role });
  }
}

module.exports = ListAllyOffersUseCase;
