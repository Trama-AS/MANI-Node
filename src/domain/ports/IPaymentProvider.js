/**
 * Puerto del proveedor de pagos (RF-24, HU-M11-01). Core es el único que habla con el proveedor (ADR-0030 §2).
 * En el Sprint 5 solo existe el mock del sandbox; el operador certificado (ADR-0023/0024) entra detrás de este mismo
 * puerto, por configuración.
 *
 * Contrato común de proveedores (SCRUM-1240, ARQ-09; docs/arquitectura/PROVEEDORES_EXTERNOS.md):
 * - `name` y `simulated` identifican al adaptador; un pago simulado nunca se presenta como real.
 * - `charge` es idempotente por `idempotencyKey`: la misma clave devuelve el mismo desenlace y no cobra dos veces.
 *   Aun así Core no reintenta un cobro automáticamente: el cliente reintenta con la misma clave.
 * - Sin desenlace lanza PaymentProviderError; nunca devuelve un éxito falso.
 * - Respeta `signal`: cuando Core aborta por timeout, el adaptador deja de esperar al proveedor.
 */
class IPaymentProvider {
  /** Nombre del adaptador; queda en cada pago para que se vea qué proveedor lo resolvió. */
  get name() {
    throw new Error('Propiedad name no implementada en IPaymentProvider');
  }

  /** `true` si el proveedor no mueve dinero real. Un pago simulado nunca se presenta como real. */
  get simulated() {
    throw new Error('Propiedad simulated no implementada en IPaymentProvider');
  }

  /**
   * Cobra un monto. Devuelve el desenlace que decidió el proveedor.
   * Lanza PaymentProviderError si no hay desenlace (timeout, respuesta inválida, proveedor caído).
   * @param {{
   *   monto: number, moneda: string, referencia: string, escenario?: string,
   *   idempotencyKey?: string, correlationId?: string, signal?: AbortSignal,
   * }} _cobro
   * @returns {Promise<{ estado: 'APROBADO' | 'RECHAZADO' | 'PENDIENTE', referencia: string, motivo?: string }>}
   */
  async charge(_cobro) {
    throw new Error('Método charge() no implementado en IPaymentProvider');
  }
}

module.exports = IPaymentProvider;
