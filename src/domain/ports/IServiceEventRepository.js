/**
 * Puerto de los eventos del servicio en Core (US-04.3.2 / SCRUM-869, RF-18): la línea de tiempo de la solicitud
 * en `evento_servicio`, con autor, tipo y hora del servidor, en el contexto de tenant del JWT (ADR-0032).
 */
class IServiceEventRepository {
  /**
   * @param {{ tenantId: string, userId: string, role: string }} _ctx contexto verificado
   * @param {{ solicitudId: string, tipo: string, observacion: string, evidenciaRuta: string|null,
   *           claveIdempotencia: string|null }} _datos
   * @returns {Promise<{ evento: object, creado: boolean }>} `creado` es false si la clave ya estaba registrada
   */
  async registrar(_ctx, _datos) {
    throw new Error('Método registrar() no implementado en IServiceEventRepository');
  }

  /**
   * @param {{ tenantId: string, userId: string, role: string }} _ctx contexto verificado
   * @param {string} _solicitudId
   * @returns {Promise<object[]>} eventos de la solicitud del más antiguo al más reciente
   */
  async listar(_ctx, _solicitudId) {
    throw new Error('Método listar() no implementado en IServiceEventRepository');
  }
}

module.exports = IServiceEventRepository;
