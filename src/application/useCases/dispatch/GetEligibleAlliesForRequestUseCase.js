const { NotFoundError } = require('../../../domain/errors/DomainError');
const { REGLAS_POR_OMISION } = require('../../../domain/rules/tenantRulesDefaults');
const { requireDispatchSession, requireUuid, tipoOpcional, paginaElegibles } = require('./dispatchAccess');

/**
 * Elegibles de una solicitud con su contexto y el criterio de orden del tenant, en una sola lectura (SCRUM-1652).
 * Dispatch armaba eligible-allies con tres llamadas a Core en serie (contexto, elegibles y reglas del tenant), cada
 * una con su transacción; en QA cada viaje a la base cuesta ~110 ms. Esta operación las reemplaza por una.
 *
 * Solo el admin del tenant y el cliente dueño: las mismas sesiones que listan elegibles. Inexistente, de otro tenant
 * o ajena a la sesión responden igual (404), como /solicitudes/{id}/context. Los rechazos no se excluyen aquí:
 * solicitud_rechazo es de Dispatch (ADR-0030), que los descuenta.
 */
class GetEligibleAlliesForRequestUseCase {
  constructor({ elegibilidadRepository }) {
    if (!elegibilidadRepository) {
      throw new Error('elegibilidadRepository es requerido para GetEligibleAlliesForRequestUseCase');
    }
    this.elegibilidadRepository = elegibilidadRepository;
  }

  async execute({ session, solicitudId, query = {} }) {
    const ctx = requireDispatchSession(session);
    requireUuid(solicitudId, 'id de la solicitud');
    const tipo = tipoOpcional(query.tipo);
    const { page, pageSize } = paginaElegibles(query);

    const resultado = await this.elegibilidadRepository.findEligibleForRequest(ctx, { solicitudId, tipo, page, pageSize });
    if (!resultado) {
      throw new NotFoundError('MANI-DSP-404: solicitud no encontrada para el tenant', 'MANI-DSP-404');
    }

    return {
      solicitud: resultado.solicitud,
      // Sin regla propia rige la de omisión, igual que GET /tenant/rules. Una regla propia sin criterio se devuelve
      // como null: Dispatch no inventa un orden (T2).
      criterioOrdenListado: resultado.tieneReglaPropia
        ? resultado.criterioOrdenListado ?? null
        : REGLAS_POR_OMISION.ordenListado.criterio,
      allies: resultado.allies,
      totalCount: resultado.totalCount,
      page,
      pageSize,
    };
  }
}

module.exports = GetEligibleAlliesForRequestUseCase;
