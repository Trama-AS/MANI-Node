const { ForbiddenError, NotFoundError, ValidationError } = require('../../../domain/errors/DomainError');
const { requireDispatchSession, requireUuid } = require('./dispatchAccess');

const TIPOS = ['OFERTA_DESPACHO'];
const CANALES = ['PUSH'];

class PublishNotificationUseCase {
  constructor({ notificacionRepository, pushProvider }) {
    if (!notificacionRepository) throw new Error('notificacionRepository es requerido para PublishNotificationUseCase');
    if (!pushProvider) throw new Error('pushProvider es requerido para PublishNotificationUseCase');
    this.notificacionRepository = notificacionRepository;
    this.pushProvider = pushProvider;
  }

  async execute({ session, body = {} }) {
    const { tenantId } = requireDispatchSession(session);

    // El tenant sale del JWT. Si el cuerpo trae otro, es un intento cross-tenant (ADR-0018).
    if (body.tenantId !== undefined && body.tenantId !== tenantId) {
      throw new ForbiddenError('MANI-DSP-403: el tenant del cuerpo no coincide con la sesión', 'MANI-DSP-403');
    }

    const allyId = requireUuid(body.allyId, 'allyId');
    if (!TIPOS.includes(body.tipo)) {
      throw new ValidationError(`MANI-DSP-400: tipo debe ser uno de ${TIPOS.join(', ')}`, 'MANI-DSP-400');
    }
    if (!CANALES.includes(body.canal)) {
      throw new ValidationError(`MANI-DSP-400: canal debe ser uno de ${CANALES.join(', ')}`, 'MANI-DSP-400');
    }
    if (!body.payload || typeof body.payload !== 'object' || Array.isArray(body.payload)) {
      throw new ValidationError('MANI-DSP-400: payload debe ser un objeto', 'MANI-DSP-400');
    }
    requireUuid(body.payload.requestId, 'payload.requestId');

    const created = await this.notificacionRepository.createForAlly({
      tenantId,
      allyId,
      tipo: body.tipo,
      canal: body.canal,
      payload: body.payload,
    });
    if (!created) {
      throw new NotFoundError('MANI-DSP-404: aliado no encontrado para el tenant', 'MANI-DSP-404');
    }

    // La notificación ya quedó en la bandeja del aliado. Si la entrega push falla, no se pierde ni se
    // repite: se informa como FALLIDA y el usuario la ve igual al abrir su bandeja (HU-M09-06).
    let entrega;
    try {
      entrega = await this.pushProvider.send({
        notificacionId: created.id,
        tenantId,
        usuarioId: created.usuarioId,
        tipo: body.tipo,
        payload: body.payload,
      });
    } catch {
      entrega = { proveedor: this.pushProvider.name, estado: 'FALLIDA', simulada: this.pushProvider.name === 'mock' };
    }
    return { id: created.id, entrega };
  }
}

module.exports = PublishNotificationUseCase;
