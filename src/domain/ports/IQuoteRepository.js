/**
 * Puerto de la cotización del servicio en Core (US-04.2.1 / SCRUM-865, RF-15).
 * Core es el dueño del estado del servicio después de la asignación (decisión 6A de la SM, SAD §7.4):
 * la cotización, el cambio de estado de la solicitud y el evento van en una sola transacción con el
 * contexto de tenant del JWT (ADR-0032).
 */
class IQuoteRepository {
  /**
   * @param {{ tenantId: string, userId: string, role: string }} _ctx contexto verificado
   * @param {{ solicitudId: string, valorManoObra: number, valorMateriales: number }} _datos importes ya validados
   * @returns {Promise<object>} la cotización creada, con su versión
   */
  async emitir(_ctx, _datos) {
    throw new Error('Método emitir() no implementado en IQuoteRepository');
  }

  /**
   * @param {{ tenantId: string, userId: string, role: string }} _ctx contexto verificado
   * @param {string} _solicitudId
   * @returns {Promise<object[]>} cotizaciones de la solicitud, de la versión más reciente a la más antigua
   */
  async listarPorSolicitud(_ctx, _solicitudId) {
    throw new Error('Método listarPorSolicitud() no implementado en IQuoteRepository');
  }

  /**
   * US-04.2.3 (SCRUM-867): el cliente dueño responde una cotización pendiente. La cotización, el estado de la
   * solicitud, el evento y la notificación al aliado van en la misma transacción.
   * @param {{ tenantId: string, userId: string, role: string }} _ctx contexto verificado
   * @param {{ cotizacionId: string, decision: { cotizacion: string, solicitud: string, evento: string,
   *           accion: string }, detalle: string }} _datos decisión ya validada
   * @returns {Promise<{ cotizacion: object, solicitud: { id: string, estado: string } }>}
   */
  async responder(_ctx, _datos) {
    throw new Error('Método responder() no implementado en IQuoteRepository');
  }
}

module.exports = IQuoteRepository;
