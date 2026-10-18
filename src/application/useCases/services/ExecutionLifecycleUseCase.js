const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} = require('../../../domain/errors/DomainError');

class ExecutionLifecycleUseCase {
  constructor({ solicitudRepository, historialSolicitudRepository }) {
    if (!solicitudRepository) throw new Error('solicitudRepository es requerido');
    if (!historialSolicitudRepository) throw new Error('historialSolicitudRepository es requerido');

    this.solicitudRepository = solicitudRepository;
    this.historialSolicitudRepository = historialSolicitudRepository;
  }

  async startExecution({ user, solicitudId, observacion }) {
    if (!user) {
      throw new ForbiddenError('Sesión requerida');
    }
    if (user.role !== 'ALLY') {
      throw new ForbiddenError('Solo el aliado asignado puede marcar el inicio de la ejecución');
    }
    if (!solicitudId) {
      throw new ValidationError('El id de la solicitud es obligatorio');
    }

    const solicitud = await this.solicitudRepository.findById(solicitudId);
    if (!solicitud || solicitud.tenantId !== user.tenantId) {
      throw new NotFoundError('Solicitud no encontrada');
    }

    if (solicitud.aliadoId !== user.userId) {
      throw new ForbiddenError('No tienes autorización para iniciar un servicio asignado a otro aliado');
    }

    if (solicitud.estado === 'EN_EJECUCION') {
      throw new ConflictError('La ejecución del servicio ya fue iniciada previamente');
    }
    if (solicitud.estado === 'FINALIZADA') {
      throw new ConflictError('El servicio ya se encuentra finalizado');
    }
    if (solicitud.estado === 'CANCELADA' || solicitud.estado === 'RECHAZADA') {
      throw new ConflictError(`No es posible iniciar un servicio en estado ${solicitud.estado}`);
    }

    const estadoAnterior = solicitud.estado;
    const ahora = new Date().toISOString();
    solicitud.estado = 'EN_EJECUCION';
    solicitud.fechaInicioEjecucion = ahora;

    await this.solicitudRepository.update(solicitud);

    await this.historialSolicitudRepository.create({
      solicitudId: solicitud.id,
      usuarioId: user.userId,
      estadoAnterior,
      estadoNuevo: 'EN_EJECUCION',
      observacion: observacion ? String(observacion).trim() : 'Inicio de ejecución reportado por el aliado',
      fecha: ahora,
    });

    return { solicitud };
  }

  async finishExecution({ user, solicitudId, observacion }) {
    if (!user) {
      throw new ForbiddenError('Sesión requerida');
    }
    if (user.role !== 'ALLY') {
      throw new ForbiddenError('Solo el aliado asignado puede marcar el fin de la ejecución');
    }
    if (!solicitudId) {
      throw new ValidationError('El id de la solicitud es obligatorio');
    }

    const solicitud = await this.solicitudRepository.findById(solicitudId);
    if (!solicitud || solicitud.tenantId !== user.tenantId) {
      throw new NotFoundError('Solicitud no encontrada');
    }

    if (solicitud.aliadoId !== user.userId) {
      throw new ForbiddenError('No tienes autorización para finalizar un servicio asignado a otro aliado');
    }

    if (solicitud.estado === 'FINALIZADA') {
      throw new ConflictError('El servicio ya se encuentra finalizado');
    }
    if (solicitud.estado !== 'EN_EJECUCION') {
      throw new ConflictError('No se puede finalizar un servicio que no ha sido iniciado');
    }

    const estadoAnterior = solicitud.estado;
    const ahora = new Date().toISOString();
    solicitud.estado = 'FINALIZADA';
    solicitud.fechaFinEjecucion = ahora;

    await this.solicitudRepository.update(solicitud);

    await this.historialSolicitudRepository.create({
      solicitudId: solicitud.id,
      usuarioId: user.userId,
      estadoAnterior,
      estadoNuevo: 'FINALIZADA',
      observacion: observacion ? String(observacion).trim() : 'Fin de ejecución reportado por el aliado',
      fecha: ahora,
    });

    return { solicitud };
  }
}

module.exports = ExecutionLifecycleUseCase;
