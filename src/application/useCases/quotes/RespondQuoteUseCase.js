const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} = require('../../../domain/errors/DomainError');

class RespondQuoteUseCase {
  constructor({ cotizacionRepository, solicitudRepository, historialSolicitudRepository }) {
    if (!cotizacionRepository) throw new Error('cotizacionRepository es requerido');
    if (!solicitudRepository) throw new Error('solicitudRepository es requerido');
    if (!historialSolicitudRepository) throw new Error('historialSolicitudRepository es requerido');

    this.cotizacionRepository = cotizacionRepository;
    this.solicitudRepository = solicitudRepository;
    this.historialSolicitudRepository = historialSolicitudRepository;
  }

  async execute({ user, cotizacionId, accion, comentario, motivo }) {
    if (!user) {
      throw new ForbiddenError('Sesión requerida');
    }
    if (user.role !== 'CLIENT') {
      throw new ForbiddenError('Solo el cliente de la solicitud puede responder a la cotización');
    }

    if (!cotizacionId) {
      throw new ValidationError('El id de la cotización es obligatorio');
    }

    const accionNormalizada = String(accion || '').trim().toUpperCase();
    const accionesValidas = ['ACEPTAR', 'RECHAZAR', 'AJUSTAR', 'SOLICITAR_AJUSTE'];
    if (!accionesValidas.includes(accionNormalizada)) {
      throw new ValidationError('Acción no permitida. Debe ser ACEPTAR, RECHAZAR o AJUSTAR');
    }

    const cotizacion = await this.cotizacionRepository.findById(cotizacionId);
    if (!cotizacion) {
      throw new NotFoundError('Cotización no encontrada');
    }

    const solicitud = await this.solicitudRepository.findById(cotizacion.solicitudId);
    if (!solicitud || solicitud.tenantId !== user.tenantId) {
      throw new NotFoundError('Solicitud no encontrada');
    }

    if (solicitud.clienteId !== user.userId) {
      throw new ForbiddenError('No tienes autorización para gestionar cotizaciones de una solicitud ajena');
    }

    // Protección de doble acción (concurrencia / idempotencia)
    if (cotizacion.estado !== 'PENDIENTE') {
      throw new ConflictError(
        `La cotización ya fue procesada previamente con estado ${cotizacion.estado}`
      );
    }

    const estadoAnteriorSolicitud = solicitud.estado;
    let observacionHistorial = '';

    if (accionNormalizada === 'ACEPTAR') {
      cotizacion.estado = 'ACEPTADA';
      solicitud.estado = 'ACEPTADA';
      observacionHistorial = comentario
        ? `Cotización v${cotizacion.version} aceptada por el cliente: ${String(comentario).trim()}`
        : `Cotización v${cotizacion.version} aceptada por el cliente`;
    } else if (accionNormalizada === 'RECHAZAR') {
      const motivoRechazo = String(motivo || comentario || '').trim();
      if (!motivoRechazo || motivoRechazo.length < 5) {
        throw new ValidationError('El motivo de rechazo es obligatorio (mínimo 5 caracteres)');
      }
      cotizacion.estado = 'RECHAZADA';
      cotizacion.observacion = motivoRechazo;
      solicitud.estado = 'RECHAZADA';
      observacionHistorial = `Cotización v${cotizacion.version} rechazada: ${motivoRechazo}`;
    } else if (accionNormalizada === 'AJUSTAR' || accionNormalizada === 'SOLICITAR_AJUSTE') {
      const detalleAjuste = String(comentario || motivo || '').trim();
      if (!detalleAjuste || detalleAjuste.length < 3) {
        throw new ValidationError('Debes indicar el comentario u observación para solicitar el ajuste');
      }
      cotizacion.estado = 'AJUSTE_SOLICITADO';
      cotizacion.observacion = detalleAjuste;
      // La solicitud permanece en estado COTIZANDO para permitir una nueva versión de cotización del aliado
      solicitud.estado = 'COTIZANDO';
      observacionHistorial = `Ajuste solicitado para cotización v${cotizacion.version}: ${detalleAjuste}`;
    }

    await this.cotizacionRepository.update(cotizacion);
    await this.solicitudRepository.update(solicitud);

    await this.historialSolicitudRepository.create({
      solicitudId: solicitud.id,
      usuarioId: user.userId,
      estadoAnterior: estadoAnteriorSolicitud,
      estadoNuevo: solicitud.estado,
      observacion: observacionHistorial,
    });

    return {
      cotizacion,
      solicitud,
    };
  }
}

module.exports = RespondQuoteUseCase;
