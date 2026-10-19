const {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} = require('../../../domain/errors/DomainError');

// Estados desde los que el aliado asignado puede iniciar la ejecución.
const ESTADOS_INICIABLES = ['ASIGNADA', 'COTIZANDO', 'ACEPTADA'];

/**
 * US-04.3.1 (SCRUM-868): el aliado asignado marca el inicio y el fin de la ejecución.
 * - El aliado se resuelve desde el usuario del JWT y se compara con `solicitud.aliado_id` (= `aliado.id`).
 * - `solicitud` no tiene columnas de fecha de ejecución: el inicio y el fin quedan como eventos en
 *   `evento_servicio`, cuya marca de tiempo es la fecha registrada.
 * - La transición de estado es atómica (UPDATE condicionado al estado de origen).
 */
class ExecutionLifecycleUseCase {
  constructor({ solicitudRepository, eventoServicioRepository, aliadoRepository }) {
    if (!solicitudRepository) throw new Error('solicitudRepository es requerido');
    if (!eventoServicioRepository) throw new Error('eventoServicioRepository es requerido');
    if (!aliadoRepository) throw new Error('aliadoRepository es requerido');

    this.solicitudRepository = solicitudRepository;
    this.eventoServicioRepository = eventoServicioRepository;
    this.aliadoRepository = aliadoRepository;
  }

  async startExecution({ user, solicitudId, observacion }) {
    return this.transicionar({
      user,
      solicitudId,
      observacion,
      desde: ESTADOS_INICIABLES,
      hacia: 'EN_EJECUCION',
      tipoEvento: 'INICIO_EJECUCION',
      porDefecto: 'Inicio de ejecución reportado por el aliado',
      conflicto: (estado) =>
        estado === 'EN_EJECUCION'
          ? 'La ejecución del servicio ya fue iniciada previamente'
          : `No es posible iniciar un servicio en estado ${estado}`,
    });
  }

  async finishExecution({ user, solicitudId, observacion }) {
    return this.transicionar({
      user,
      solicitudId,
      observacion,
      desde: ['EN_EJECUCION'],
      hacia: 'FINALIZADA',
      tipoEvento: 'FIN_EJECUCION',
      porDefecto: 'Fin de ejecución reportado por el aliado',
      conflicto: (estado) =>
        estado === 'FINALIZADA'
          ? 'El servicio ya se encuentra finalizado'
          : 'No se puede finalizar un servicio que no ha sido iniciado',
    });
  }

  async transicionar({ user, solicitudId, observacion, desde, hacia, tipoEvento, porDefecto, conflicto }) {
    if (!user || !user.tenantId || !user.userId) {
      throw new ForbiddenError('Sesión requerida');
    }
    if (user.role !== 'ALLY') {
      throw new ForbiddenError('Solo el aliado asignado puede marcar el inicio o el fin de la ejecución');
    }
    if (!solicitudId) {
      throw new ValidationError('El id de la solicitud es obligatorio');
    }

    const ctx = { tenantId: user.tenantId, userId: user.userId, role: user.role };

    const aliado = await this.aliadoRepository.findByUsuarioId(user.tenantId, user.userId);
    if (!aliado) {
      throw new ForbiddenError('No existe un perfil de aliado para la cuenta en este tenant');
    }

    const solicitud = await this.solicitudRepository.findById(ctx, solicitudId);
    if (!solicitud) {
      throw new NotFoundError('Solicitud no encontrada');
    }
    if (solicitud.aliadoId !== aliado.id) {
      throw new ForbiddenError('No tienes autorización sobre un servicio asignado a otro aliado');
    }

    const actualizada = await this.solicitudRepository.transicionarEstado(ctx, solicitudId, desde, hacia);
    if (!actualizada) {
      const actual = await this.solicitudRepository.findById(ctx, solicitudId);
      throw new ConflictError(conflicto(actual ? actual.estado : solicitud.estado));
    }

    const evento = await this.eventoServicioRepository.create(ctx, {
      solicitudId,
      actorId: user.userId,
      tipoEvento,
      descripcion: observacion ? String(observacion).trim() : porDefecto,
    });

    return { solicitud: actualizada, evento };
  }
}

module.exports = ExecutionLifecycleUseCase;
