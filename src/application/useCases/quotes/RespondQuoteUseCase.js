const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} = require('../../../domain/errors/DomainError');

const TRANSICIONES = {
  ACEPTAR: { cotizacion: 'ACEPTADA', solicitud: 'ACEPTADA', evento: 'COTIZACION_ACEPTADA' },
  RECHAZAR: { cotizacion: 'RECHAZADA', solicitud: 'RECHAZADA', evento: 'COTIZACION_RECHAZADA' },
  // La solicitud vuelve a COTIZANDO para que el aliado emita una nueva versión.
  AJUSTAR: { cotizacion: 'AJUSTE_SOLICITADO', solicitud: 'COTIZANDO', evento: 'AJUSTE_SOLICITADO' },
};

// Texto que acompaña la respuesta: el rechazo exige motivo y el ajuste exige comentario.
function detalleDeRespuesta(accion, comentario, motivo) {
  if (accion === 'RECHAZAR') {
    const texto = String(motivo || comentario || '').trim();
    if (texto.length < 5) throw new ValidationError('El motivo de rechazo es obligatorio (mínimo 5 caracteres)');
    return texto;
  }
  const texto = comentario ? String(comentario).trim() : '';
  if (accion === 'AJUSTAR' && texto.length < 3) {
    throw new ValidationError('Debes indicar el comentario u observación para solicitar el ajuste');
  }
  return texto;
}

/**
 * US-04.2.3 (SCRUM-867): el cliente dueño de la solicitud acepta, rechaza o pide ajustar una cotización.
 * - El cliente se resuelve desde el usuario del JWT y se compara `solicitud.cliente_id` con `cliente.id`.
 * - La transición es atómica (solo desde PENDIENTE): dos respuestas simultáneas no se pisan (409).
 */
class RespondQuoteUseCase {
  constructor({ cotizacionRepository, solicitudRepository, eventoServicioRepository, clienteRepository }) {
    if (!cotizacionRepository) throw new Error('cotizacionRepository es requerido');
    if (!solicitudRepository) throw new Error('solicitudRepository es requerido');
    if (!eventoServicioRepository) throw new Error('eventoServicioRepository es requerido');
    if (!clienteRepository) throw new Error('clienteRepository es requerido');

    this.cotizacionRepository = cotizacionRepository;
    this.solicitudRepository = solicitudRepository;
    this.eventoServicioRepository = eventoServicioRepository;
    this.clienteRepository = clienteRepository;
  }

  async execute({ user, cotizacionId, accion, comentario, motivo }) {
    if (!user || !user.tenantId || !user.userId) {
      throw new ForbiddenError('Sesión requerida');
    }
    if (user.role !== 'CLIENT') {
      throw new ForbiddenError('Solo el cliente de la solicitud puede responder a la cotización');
    }
    if (!cotizacionId) {
      throw new ValidationError('El id de la cotización es obligatorio');
    }

    const accionNormalizada = String(accion || '').trim().toUpperCase();
    const transicion = TRANSICIONES[accionNormalizada];
    if (!transicion) {
      throw new ValidationError('Acción no permitida. Debe ser ACEPTAR, RECHAZAR o AJUSTAR');
    }

    const detalle = detalleDeRespuesta(accionNormalizada, comentario, motivo);

    const ctx = { tenantId: user.tenantId, userId: user.userId, role: user.role };

    const cliente = await this.clienteRepository.findByUsuarioId(user.tenantId, user.userId);
    if (!cliente) {
      throw new ForbiddenError('No existe un perfil de cliente para la cuenta en este tenant');
    }

    const cotizacion = await this.cotizacionRepository.findById(ctx, cotizacionId);
    if (!cotizacion) {
      throw new NotFoundError('Cotización no encontrada');
    }

    const solicitud = await this.solicitudRepository.findById(ctx, cotizacion.solicitudId);
    if (!solicitud) {
      throw new NotFoundError('Solicitud no encontrada');
    }
    if (solicitud.clienteId !== cliente.id) {
      throw new ForbiddenError('No tienes autorización para gestionar cotizaciones de una solicitud ajena');
    }

    const actualizada = await this.cotizacionRepository.updateEstado(ctx, cotizacionId, transicion.cotizacion, {
      soloSiEstado: 'PENDIENTE',
    });
    if (!actualizada) {
      throw new ConflictError('La cotización ya fue procesada previamente');
    }

    const solicitudActualizada = await this.solicitudRepository.updateEstado(ctx, solicitud.id, transicion.solicitud);

    await this.eventoServicioRepository.create(ctx, {
      solicitudId: solicitud.id,
      actorId: user.userId,
      tipoEvento: transicion.evento,
      descripcion: detalle
        ? `Cotización v${actualizada.version}: ${detalle}`
        : `Cotización v${actualizada.version} ${transicion.cotizacion.toLowerCase()}`,
    });

    return { cotizacion: actualizada, solicitud: solicitudActualizada };
  }
}

module.exports = RespondQuoteUseCase;
