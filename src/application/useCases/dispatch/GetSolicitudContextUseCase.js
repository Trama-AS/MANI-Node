const { NotFoundError } = require('../../../domain/errors/DomainError');
const { requireDispatchSession, requireUuid } = require('./dispatchAccess');

class GetSolicitudContextUseCase {
  constructor({ solicitudContextRepository }) {
    if (!solicitudContextRepository) {
      throw new Error('solicitudContextRepository es requerido para GetSolicitudContextUseCase');
    }
    this.solicitudContextRepository = solicitudContextRepository;
  }

  async execute({ session, solicitudId }) {
    const { tenantId } = requireDispatchSession(session);
    requireUuid(solicitudId, 'id de la solicitud');

    const context = await this.solicitudContextRepository.findContext(tenantId, solicitudId);
    if (!context) {
      throw new NotFoundError('MANI-DSP-404: solicitud no encontrada para el tenant', 'MANI-DSP-404');
    }
    return context;
  }
}

module.exports = GetSolicitudContextUseCase;
