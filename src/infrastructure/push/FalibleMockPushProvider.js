const MockPushProvider = require('./MockPushProvider');
const PushProviderError = require('../../domain/errors/PushProviderError');

/**
 * Proveedor push simulado con falla inyectable (SCRUM-1662, QAS-02 y 09). Se elige con `PUSH_PROVIDER=mock_falla` y sirve
 * para comprobar, en DEV, QA y CI, que una falla de notificación no revierte la operación que la originó y que el
 * reintento recupera las fallas pasajeras.
 *
 * `fallas` es cuántos intentos consecutivos fallan POR NOTIFICACIÓN antes de que el siguiente funcione:
 *   - `Infinity` (por omisión): falla siempre; sirve para ver la bandeja con la entrega FALLIDA.
 *   - un entero (`PUSH_MOCK_FALLAS=1`): falla pasajera; el primer intento falla y el reintento entrega.
 * La clave es la `idempotencyKey` (el id de la notificación), igual que la del contrato común de proveedores.
 */
class FalibleMockPushProvider extends MockPushProvider {
  constructor({ fallas = Number.POSITIVE_INFINITY, ...opciones } = {}) {
    super(opciones);
    this.fallas = fallas;
    this.intentos = new Map();
  }

  get name() {
    return 'mock_falla';
  }

  async send(mensaje) {
    const clave = mensaje.idempotencyKey ?? mensaje.notificacionId ?? 'sin-clave';
    const intento = (this.intentos.get(clave) ?? 0) + 1;
    this.intentos.set(clave, intento);
    if (intento <= this.fallas) {
      throw new PushProviderError('UNAVAILABLE', `Falla inyectada de PUSH_PROVIDER=mock_falla (intento ${intento})`);
    }
    return super.send(mensaje);
  }
}

module.exports = FalibleMockPushProvider;
