const { ForbiddenError } = require('../../../domain/errors/DomainError');

/**
 * US-04.6.1 (SCRUM-879): historial de servicios del cliente autenticado, con la cotización final de cada uno
 * (la aceptada o, si no hay, la última versión). Las solicitudes se buscan por el `cliente.id` del usuario
 * (no por el id del usuario), siempre dentro del tenant del JWT.
 */
class GetClientServicesHistoryUseCase {
  constructor({ solicitudRepository, cotizacionRepository, clienteRepository }) {
    if (!solicitudRepository) throw new Error('solicitudRepository es requerido');
    if (!cotizacionRepository) throw new Error('cotizacionRepository es requerido');
    if (!clienteRepository) throw new Error('clienteRepository es requerido');

    this.solicitudRepository = solicitudRepository;
    this.cotizacionRepository = cotizacionRepository;
    this.clienteRepository = clienteRepository;
  }

  async execute({ user, estado }) {
    if (!user || !user.tenantId || !user.userId) {
      throw new ForbiddenError('Sesión requerida');
    }
    if (user.role !== 'CLIENT') {
      throw new ForbiddenError('Solo los clientes pueden consultar su historial de servicios');
    }

    const ctx = { tenantId: user.tenantId, userId: user.userId, role: user.role };

    const cliente = await this.clienteRepository.findByUsuarioId(user.tenantId, user.userId);
    if (!cliente) {
      throw new ForbiddenError('No existe un perfil de cliente para la cuenta en este tenant');
    }

    const solicitudes = await this.solicitudRepository.findByClienteId(ctx, cliente.id, {
      estado: estado ? String(estado).trim().toUpperCase() : null,
    });

    const servicios = await Promise.all(
      solicitudes.map(async (solicitud) => {
        const cotizaciones = await this.cotizacionRepository.findBySolicitudId(ctx, solicitud.id);
        const final = cotizaciones.find((c) => c.estado === 'ACEPTADA') || cotizaciones.at(-1) || null;
        return { ...solicitud.toJSON(), cotizacion: final ? final.toJSON() : null };
      })
    );

    return { servicios, total: servicios.length };
  }
}

module.exports = GetClientServicesHistoryUseCase;
