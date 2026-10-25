/**
 * Puerto del proveedor de notificaciones push (RF-20, HU-M09-06). Core es el único emisor hacia el proveedor
 * (ADR-0030 §2): la notificación se persiste primero en `notificacion` y después se entrega por aquí.
 */
class IPushProvider {
  /** Nombre corto del adaptador, visible en la respuesta para que el front sepa si la entrega es simulada. */
  get name() {
    throw new Error('Propiedad name no implementada en IPushProvider');
  }

  /**
   * Entrega la notificación ya persistida al dispositivo del usuario.
   * @param {{ notificacionId: string, tenantId: string, usuarioId: string, tipo: string, payload: object }} _notification
   * @returns {Promise<{ proveedor: string, estado: 'ENTREGADA' | 'SIMULADA', simulada: boolean, mensajeId: string }>}
   */
  async send(_notification) {
    throw new Error('Método send() no implementado en IPushProvider');
  }
}

module.exports = IPushProvider;
