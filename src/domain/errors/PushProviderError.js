const ProviderError = require('./ProviderError');

/**
 * Fallo del proveedor push (HU-M09-06, SCRUM-1240): la entrega no tuvo desenlace. La notificación ya está persistida
 * en `notificacion`, así que el usuario la ve en su bandeja aunque la entrega falle.
 */
class PushProviderError extends ProviderError {
  /** @param {'TIMEOUT' | 'INVALID_RESPONSE' | 'UNAVAILABLE'} kind */
  constructor(kind, message) {
    super(kind, message);
    this.name = 'PushProviderError';
  }
}

module.exports = PushProviderError;
