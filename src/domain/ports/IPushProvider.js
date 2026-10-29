/**
 * Puerto del proveedor de notificaciones push (RF-20, HU-M09-06). Core es el único emisor hacia el proveedor
 * (ADR-0030 §2): la notificación se persiste primero en `notificacion` y después se entrega por aquí.
 *
 * Contrato común de proveedores (SCRUM-1240, ARQ-09; docs/arquitectura/PROVEEDORES_EXTERNOS.md):
 * - `name` y `simulated` identifican al adaptador; una entrega simulada nunca se presenta como real.
 * - `send` es idempotente por `idempotencyKey` (el id de la notificación): repetirla no entrega dos veces.
 * - Sin desenlace (timeout, caído, respuesta fuera de contrato) lanza PushProviderError; nunca devuelve un éxito falso.
 * - Respeta `signal`: cuando Core aborta por timeout, el adaptador deja de esperar al proveedor.
 */
class IPushProvider {
  /** Nombre corto del adaptador, visible en la respuesta para que el front sepa qué proveedor entregó. */
  get name() {
    throw new Error('Propiedad name no implementada en IPushProvider');
  }

  /** `true` si el adaptador no entrega a dispositivos reales. */
  get simulated() {
    throw new Error('Propiedad simulated no implementada en IPushProvider');
  }

  /**
   * Entrega la notificación ya persistida al dispositivo del usuario.
   * @param {{
   *   notificacionId: string, tenantId: string, usuarioId: string, tipo: string, payload: object,
   *   idempotencyKey?: string, correlationId?: string, signal?: AbortSignal,
   * }} _notification
   * @returns {Promise<{ proveedor: string, estado: 'ENTREGADA' | 'SIMULADA', simulada: boolean, mensajeId: string }>}
   */
  async send(_notification) {
    throw new Error('Método send() no implementado en IPushProvider');
  }
}

module.exports = IPushProvider;
