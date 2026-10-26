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
}

module.exports = IQuoteRepository;
