/**
 * Puerto del proveedor de pagos (RF-24, HU-M11-01). Core es el único que habla con el proveedor (ADR-0030 §2).
 * En el Sprint 5 solo existe el mock del sandbox; el operador certificado (ADR-0023/0024) entra detrás de este mismo
 * puerto, por configuración. El contrato común de proveedores lo define SCRUM-1240 (ARQ-09): este puerto se alinea
 * con él cuando se publique.
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
   * @param {{ monto: number, moneda: string, referencia: string, escenario?: string, correlationId?: string }} _cobro
   * @returns {Promise<{ estado: 'APROBADO' | 'RECHAZADO' | 'PENDIENTE', referencia: string, motivo?: string }>}
   */
  async charge(_cobro) {
    throw new Error('Método charge() no implementado en IPaymentProvider');
  }
}

module.exports = IPaymentProvider;
