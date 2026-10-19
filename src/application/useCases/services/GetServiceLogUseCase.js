const { ValidationError, NotFoundError, ForbiddenError } = require('../../../domain/errors/DomainError');

/**
 * US-04.3.3 (SCRUM-870): log cronológico del servicio, leído de `evento_servicio` del tenant.
 * - Cliente: solo si es el dueño (`solicitud.cliente_id` = `cliente.id` del usuario).
 * - Aliado: solo si la solicitud está asignada a su `aliado.id`.
 * - Administrador del tenant: cualquier solicitud del tenant.
 */
class GetServiceLogUseCase {
  constructor({ solicitudRepository, eventoServicioRepository, clienteRepository, aliadoRepository }) {
    if (!solicitudRepository) throw new Error('solicitudRepository es requerido');
    if (!eventoServicioRepository) throw new Error('eventoServicioRepository es requerido');
    if (!clienteRepository) throw new Error('clienteRepository es requerido');
    if (!aliadoRepository) throw new Error('aliadoRepository es requerido');

    this.solicitudRepository = solicitudRepository;
    this.eventoServicioRepository = eventoServicioRepository;
    this.clienteRepository = clienteRepository;
    this.aliadoRepository = aliadoRepository;
  }

  async execute({ user, solicitudId }) {
    if (!user || !user.tenantId || !user.userId) {
      throw new ForbiddenError('Sesión requerida');
    }
    if (!['CLIENT', 'ALLY', 'ADMIN'].includes(user.role)) {
      throw new ForbiddenError('Rol no autorizado para consultar el log del servicio');
    }
    if (!solicitudId) {
      throw new ValidationError('El id de la solicitud es obligatorio');
    }

    const ctx = { tenantId: user.tenantId, userId: user.userId, role: user.role };

    const solicitud = await this.solicitudRepository.findById(ctx, solicitudId);
    if (!solicitud) {
      throw new NotFoundError('Solicitud no encontrada');
    }

    if (user.role === 'CLIENT') {
      const cliente = await this.clienteRepository.findByUsuarioId(user.tenantId, user.userId);
      if (!cliente || solicitud.clienteId !== cliente.id) {
        throw new ForbiddenError('No tienes autorización para consultar el log de una solicitud ajena');
      }
    }
    if (user.role === 'ALLY') {
      const aliado = await this.aliadoRepository.findByUsuarioId(user.tenantId, user.userId);
      if (!aliado || solicitud.aliadoId !== aliado.id) {
        throw new ForbiddenError('No tienes autorización para consultar el log de una solicitud asignada a otro aliado');
      }
    }

    const eventos = await this.eventoServicioRepository.findBySolicitudId(ctx, solicitud.id);
    const log = eventos.length
      ? eventos.map((e) => e.toJSON())
      : [
          {
            id: null,
            solicitudId: solicitud.id,
            actorId: null,
            tipoEvento: 'SOLICITUD_CREADA',
            descripcion: 'Solicitud de servicio registrada',
            evidenciaRuta: null,
            fecha: solicitud.fechaCreacion,
          },
        ];

    return { solicitud, log };
  }
}

module.exports = GetServiceLogUseCase;
