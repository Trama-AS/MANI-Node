const { ForbiddenError, NotFoundError, ValidationError } = require('../../../domain/errors/DomainError');
const { requireDispatchSession, requireUuid } = require('./dispatchAccess');
const PushProviderError = require('../../../domain/errors/PushProviderError');
const callProvider = require('../../providers/callProvider');

const TIPOS = ['OFERTA_DESPACHO'];
const CANALES = ['PUSH'];

// Política de proveedores (SCRUM-1240): la entrega push es idempotente por el id de la notificación, así que un fallo
// pasajero se reintenta dos veces sin entregar doble.
const POLITICA_PUSH = Object.freeze({ timeoutMs: 5000, retries: 2, baseDelayMs: 100 });

class PublishNotificationUseCase {
  constructor({ notificacionRepository, pushProvider, politica = POLITICA_PUSH }) {
    if (!notificacionRepository) throw new Error('notificacionRepository es requerido para PublishNotificationUseCase');
    if (!pushProvider) throw new Error('pushProvider es requerido para PublishNotificationUseCase');
    this.notificacionRepository = notificacionRepository;
    this.pushProvider = pushProvider;
    this.politica = { ...POLITICA_PUSH, ...politica };
  }

  async execute({ session, body = {}, correlationId }) {
    const ctx = requireDispatchSession(session);
    const { tenantId } = ctx;

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

    const created = await this.notificacionRepository.createForAlly(ctx, {
      allyId,
      tipo: body.tipo,
      canal: body.canal,
      payload: body.payload,
    });
    if (!created) {
      throw new NotFoundError('MANI-DSP-404: aliado no encontrado para el tenant', 'MANI-DSP-404');
    }

    // Reintento de una orquestación (RNF-03): la oferta ya estaba en la bandeja del aliado y el push no se repite.
    if (created.nueva === false) {
      return { id: created.id, nueva: false, entrega: null };
    }

    // La notificación ya quedó en la bandeja del aliado. Si la entrega push falla, no se pierde ni se
    // repite: se informa como FALLIDA y el usuario la ve igual al abrir su bandeja (HU-M09-06).
    let entrega;
    try {
      entrega = await callProvider(
        ({ signal }) =>
          this.pushProvider.send({
            notificacionId: created.id,
            tenantId,
            usuarioId: created.usuarioId,
            tipo: body.tipo,
            payload: body.payload,
            idempotencyKey: created.id,
            correlationId,
            signal,
          }),
        { ...this.politica, ErrorClass: PushProviderError, proveedor: `El proveedor push ${this.pushProvider.name}` }
      );
    } catch {
      entrega = { proveedor: this.pushProvider.name, estado: 'FALLIDA', simulada: this.pushProvider.simulated === true };
    }
    return { id: created.id, nueva: true, entrega };
  }
}

PublishNotificationUseCase.POLITICA_PUSH = POLITICA_PUSH;
module.exports = PublishNotificationUseCase;
