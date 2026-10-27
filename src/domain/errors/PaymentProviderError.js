const ProviderError = require('./ProviderError');

/**
 * Fallo del proveedor de pagos (HU-M11-01, C2): no respondió a tiempo, no respondió o respondió algo que el contrato
 * no permite. Nunca es un pago rechazado —eso es un desenlace válido del proveedor—, sino la ausencia de un
 * desenlace: por eso no deja pago registrado ni efecto financiero. Es un ProviderError (SCRUM-1240).
 */
class PaymentProviderError extends ProviderError {
  /** @param {'TIMEOUT' | 'INVALID_RESPONSE' | 'UNAVAILABLE'} kind */
  constructor(kind, message) {
    super(kind, message);
    this.name = 'PaymentProviderError';
  }
}

module.exports = PaymentProviderError;
