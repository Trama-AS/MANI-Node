const {
  ForbiddenError,
} = require('../../../domain/errors/DomainError');

class GetClientServicesHistoryUseCase {
  constructor({ solicitudRepository, cotizacionRepository = null }) {
    if (!solicitudRepository) throw new Error('solicitudRepository es requerido');

    this.solicitudRepository = solicitudRepository;
    this.cotizacionRepository = cotizacionRepository;
  }

  async execute({ user, estado }) {
    if (!user) {
      throw new ForbiddenError('Sesión requerida');
    }
    if (user.role !== 'CLIENT') {
      throw new ForbiddenError('Solo los clientes pueden consultar su historial de servicios');
    }

    const estadoFiltro = estado ? String(estado).trim().toUpperCase() : null;

    const solicitudes = await this.solicitudRepository.findByClienteId(user.userId, {
      tenantId: user.tenantId,
      estado: estadoFiltro,
    });

    const servicios = await Promise.all(
      solicitudes.map(async (solicitud) => {
        let cotizacionFinal = null;
        if (this.cotizacionRepository) {
          const cotizaciones = await this.cotizacionRepository.findBySolicitudId(solicitud.id);
          const aceptada = cotizaciones.find((c) => c.estado === 'ACEPTADA');
          cotizacionFinal = aceptada || cotizaciones[cotizaciones.length - 1] || null;
        }

        return {
          ...solicitud.toJSON(),
          cotizacion: cotizacionFinal
            ? typeof cotizacionFinal.toJSON === 'function'
              ? cotizacionFinal.toJSON()
              : cotizacionFinal
            : null,
        };
      })
    );

    return {
      servicios,
      total: servicios.length,
    };
  }
}

module.exports = GetClientServicesHistoryUseCase;
