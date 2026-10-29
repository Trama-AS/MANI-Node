/**
 * Puerto de la ejecución del servicio en Core (US-04.3.1 / SCRUM-868, RF-18). Core es el dueño del estado tras
 * la asignación (decisión 6A, SAD §7.4): la transición, el evento con la hora del servidor y el aviso al cliente
 * van en la misma transacción, con el contexto de tenant del JWT (ADR-0032).
 */
class IServiceExecutionRepository {
  /**
   * @param {{ tenantId: string, userId: string, role: string }} _ctx contexto verificado
   * @param {{ solicitudId: string, hito: 'INICIO' | 'FIN', observacion: string }} _datos
   * @returns {Promise<{ solicitud: { id: string, estado: string }, evento: { tipo: string, registradoEn: Date } }>}
   */
  async marcar(_ctx, _datos) {
    throw new Error('Método marcar() no implementado en IServiceExecutionRepository');
  }

  /**
   * @param {{ tenantId: string, userId: string, role: string }} _ctx contexto verificado
   * @param {string} _solicitudId
   * @returns {Promise<{ solicitudId: string, estado: string, inicio: object|null, fin: object|null }>}
   */
  async consultar(_ctx, _solicitudId) {
    throw new Error('Método consultar() no implementado en IServiceExecutionRepository');
  }
}

module.exports = IServiceExecutionRepository;
