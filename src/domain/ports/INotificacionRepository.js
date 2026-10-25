/**
 * Puerto de dominio de la mensajería (tabla `notificacion`): Core es su dueño y Dispatch notifica a través
 * de Core (ADR-0022, ADR-0030).
 */
class INotificacionRepository {
  /**
   * Crea la notificación para el usuario del aliado. Devuelve null si el aliado no existe en el tenant.
   * @returns {Promise<{ id: string, usuarioId: string } | null>}
   */
  async createForAlly(_notification) {
    throw new Error('Método createForAlly() no implementado en INotificacionRepository');
  }

  /** @returns {Promise<Array<{ payload: object, enviadoAt: Date }>>} */
  async listByRequest(_tenantId, _requestId, _tipo) {
    throw new Error('Método listByRequest() no implementado en INotificacionRepository');
  }

  /**
   * Bandeja del usuario autenticado, de la más reciente a la más antigua (HU-M09-06).
   * @returns {Promise<Array<{ id: string, tipo: string, canal: string, payload: object, enviadoAt: Date, leidoAt: Date | null }>>}
   */
  async listForUser(_tenantId, _usuarioId, _options) {
    throw new Error('Método listForUser() no implementado en INotificacionRepository');
  }
}

module.exports = INotificacionRepository;
