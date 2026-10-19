/**
 * Puerto de dominio de la mensajería (tabla `notificacion`): Core es su dueño y Dispatch notifica a través
 * de Core (ADR-0022, ADR-0030).
 */
class INotificacionRepository {
  /**
   * Crea la notificación para el usuario del aliado. Devuelve null si el aliado no existe en el tenant.
   * @returns {Promise<{ id: string } | null>}
   */
  async createForAlly(_notification) {
    throw new Error('Método createForAlly() no implementado en INotificacionRepository');
  }

  /** @returns {Promise<Array<{ payload: object, enviadoAt: Date }>>} */
  async listByRequest(_tenantId, _requestId, _tipo) {
    throw new Error('Método listByRequest() no implementado en INotificacionRepository');
  }
}

module.exports = INotificacionRepository;
