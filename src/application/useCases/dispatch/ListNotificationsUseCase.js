const { ValidationError } = require('../../../domain/errors/DomainError');
const { requireDispatchSession, requireUuid } = require('./dispatchAccess');

class ListNotificationsUseCase {
  constructor({ notificacionRepository }) {
    if (!notificacionRepository) throw new Error('notificacionRepository es requerido para ListNotificationsUseCase');
    this.notificacionRepository = notificacionRepository;
  }

  /** Ofertas ya publicadas para una solicitud: Dispatch las usa para no duplicarlas (RNF-03). */
  async execute({ session, query = {} }) {
    const { tenantId } = requireDispatchSession(session);
    const requestId = requireUuid(query.requestId, 'requestId');
    const tipo = query.tipo || 'OFERTA_DESPACHO';
    if (tipo !== 'OFERTA_DESPACHO') {
      throw new ValidationError('MANI-DSP-400: tipo debe ser OFERTA_DESPACHO', 'MANI-DSP-400');
    }

    const rows = await this.notificacionRepository.listByRequest(tenantId, requestId, tipo);
    return rows.map(({ payload, enviadoAt }) => ({
      ...payload,
      timestamp: payload.timestamp || (enviadoAt instanceof Date ? enviadoAt.toISOString() : enviadoAt),
    }));
  }
}

module.exports = ListNotificationsUseCase;
