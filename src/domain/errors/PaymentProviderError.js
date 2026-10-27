/**
 * Fallo del proveedor de pagos (HU-M11-01, C2): no respondió a tiempo, no respondió o respondió algo que el contrato
 * no permite. Nunca es un pago rechazado —eso es un desenlace válido del proveedor—, sino la ausencia de un
 * desenlace: por eso no deja pago registrado ni efecto financiero.
 */
class PaymentProviderError extends Error {
  /** @param {'TIMEOUT' | 'INVALID_RESPONSE' | 'UNAVAILABLE'} kind */
  constructor(kind, message) {
    super(message || kind);
    this.name = 'PaymentProviderError';
    this.kind = kind;
  }
}

module.exports = PaymentProviderError;
