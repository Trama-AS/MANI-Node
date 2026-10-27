const { NotFoundError } = require('../../../domain/errors/DomainError');
const { requireContextSession, requireUuid } = require('./dispatchAccess');

class GetSolicitudContextUseCase {
  constructor({ solicitudContextRepository }) {
    if (!solicitudContextRepository) {
      throw new Error('solicitudContextRepository es requerido para GetSolicitudContextUseCase');
    }
    this.solicitudContextRepository = solicitudContextRepository;
  }

  async execute({ session, solicitudId }) {
    const ctx = requireContextSession(session);
    requireUuid(solicitudId, 'id de la solicitud');

    // Inexistente, de otro tenant o ajena a la sesión responden igual: no se revela que el id existe.
    const context = await this.solicitudContextRepository.findContext(ctx, solicitudId);
    if (!context) {
      throw new NotFoundError('MANI-DSP-404: solicitud no encontrada para el tenant', 'MANI-DSP-404');
    }
    return context;
  }
}

module.exports = GetSolicitudContextUseCase;
