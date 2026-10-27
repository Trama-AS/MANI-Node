/**
 * Puerto de dominio de la mensajería (tabla `notificacion`): Core es su dueño y Dispatch notifica a través
 * de Core (ADR-0022, ADR-0030). Cada método recibe el contexto verificado de la sesión
 * (`{ tenantId, userId, role }`) y opera solo dentro de ese tenant.
 */
class INotificacionRepository {
  /**
   * Crea la notificación para el usuario del aliado. Devuelve null si el aliado no existe en el tenant.
   * Una oferta de despacho que ya existe para ese aliado y solicitud no se duplica: se devuelve con `nueva` false.
   * @returns {Promise<{ id: string, usuarioId: string, nueva: boolean } | null>}
   */
  async createForAlly(_ctx, _notification) {
    throw new Error('Método createForAlly() no implementado en INotificacionRepository');
  }

  /** @returns {Promise<Array<{ payload: object, enviadoAt: Date }>>} */
  async listByRequest(_ctx, _requestId, _tipo) {
    throw new Error('Método listByRequest() no implementado en INotificacionRepository');
  }

  /**
   * Bandeja del usuario autenticado (`ctx.userId`), de la más reciente a la más antigua (HU-M09-06).
   * @returns {Promise<Array<{ id: string, tipo: string, canal: string, payload: object, enviadoAt: Date, leidoAt: Date | null }>>}
   */
  async listForUser(_ctx, _options) {
    throw new Error('Método listForUser() no implementado en INotificacionRepository');
  }
}

module.exports = INotificacionRepository;
