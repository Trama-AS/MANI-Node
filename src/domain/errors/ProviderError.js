const KINDS = ['TIMEOUT', 'UNAVAILABLE', 'INVALID_RESPONSE'];

/**
 * Fallo de un proveedor externo (SCRUM-1240, ARQ-09): no hubo desenlace. Es común a pagos y notificaciones para que
 * los casos de uso traten igual un proveedor que no respondió a tiempo (`TIMEOUT`), que no se pudo usar
 * (`UNAVAILABLE`) o que respondió algo que su contrato no permite (`INVALID_RESPONSE`).
 *
 * Un desenlace negativo del proveedor (un pago RECHAZADO, por ejemplo) NO es un ProviderError: es una respuesta válida.
 */
class ProviderError extends Error {
  /**
   * @param {'TIMEOUT' | 'UNAVAILABLE' | 'INVALID_RESPONSE'} kind
   * @param {string} [message]
   */
  constructor(kind, message) {
    super(message || kind);
    if (!KINDS.includes(kind)) throw new TypeError(`ProviderError: kind inválido "${kind}"`);
    this.name = 'ProviderError';
    this.kind = kind;
  }

  /** `true` si el fallo puede deberse a algo pasajero y la operación se puede repetir sin efecto doble. */
  get transient() {
    return this.kind === 'TIMEOUT' || this.kind === 'UNAVAILABLE';
  }
}

ProviderError.KINDS = KINDS;
module.exports = ProviderError;
