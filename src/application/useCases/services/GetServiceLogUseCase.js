const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} = require('../../../domain/errors/DomainError');

class GetServiceLogUseCase {
  constructor({ solicitudRepository, historialSolicitudRepository }) {
    if (!solicitudRepository) throw new Error('solicitudRepository es requerido');
    if (!historialSolicitudRepository) throw new Error('historialSolicitudRepository es requerido');

    this.solicitudRepository = solicitudRepository;
    this.historialSolicitudRepository = historialSolicitudRepository;
  }

  async execute({ user, solicitudId }) {
    if (!user) {
      throw new ForbiddenError('Sesión requerida');
    }
    if (!solicitudId) {
      throw new ValidationError('El id de la solicitud es obligatorio');
    }

    const solicitud = await this.solicitudRepository.findById(solicitudId);
    if (!solicitud || solicitud.tenantId !== user.tenantId) {
      throw new NotFoundError('Solicitud no encontrada');
    }

    if (user.role === 'CLIENT' && solicitud.clienteId !== user.userId) {
      throw new ForbiddenError('No tienes autorización para consultar el log de una solicitud ajena');
    }
    if (user.role === 'ALLY' && solicitud.aliadoId && solicitud.aliadoId !== user.userId) {
      throw new ForbiddenError('No tienes autorización para consultar el log de una solicitud asignada a otro aliado');
    }

    const eventos = await this.historialSolicitudRepository.findBySolicitudId(solicitud.id);

    // Si aún no hay eventos registrados, entrega al menos el evento de creación inicial
    let log = eventos.sort((a, b) => new Date(a.fecha) - new Date(b.fecha));
    if (log.length === 0) {
      log = [
        {
          id: `init-${solicitud.id}`,
          solicitudId: solicitud.id,
          usuarioId: solicitud.clienteId,
          estadoAnterior: null,
          estadoNuevo: solicitud.estado,
          observacion: 'Solicitud de servicio registrada',
          fotoUrl: null,
          fecha: solicitud.fechaCreacion,
        },
      ];
    }

    return {
      solicitud,
      log,
    };
  }
}

module.exports = GetServiceLogUseCase;
