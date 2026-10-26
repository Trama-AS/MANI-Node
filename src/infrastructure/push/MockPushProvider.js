const crypto = require('node:crypto');
const IPushProvider = require('../../domain/ports/IPushProvider');

const DEFAULT_MAX_SENT = 500;

/**
 * Proveedor push simulado (HU-M09-06, CONS-35): no llama a FCM ni a APNs. Responde como un proveedor real
 * que aceptó el mensaje, marcado `simulada: true`, y guarda en memoria lo que habría enviado para poder
 * inspeccionarlo en pruebas y en DEV. La bandeja que consulta el front sale de la tabla `notificacion`,
 * no de esta memoria, así que sobrevive a un reinicio de Core.
 */
class MockPushProvider extends IPushProvider {
  constructor({ maxSent = DEFAULT_MAX_SENT, idFactory = () => crypto.randomUUID() } = {}) {
    super();
    this.maxSent = maxSent;
    this.idFactory = idFactory;
    this.sent = [];
  }

  get name() {
    return 'mock';
  }

  async send({ notificacionId, tenantId, usuarioId, tipo, payload }) {
    const mensajeId = `mock-${this.idFactory()}`;
    this.sent.push({ mensajeId, notificacionId, tenantId, usuarioId, tipo, payload, enviadoAt: new Date().toISOString() });
    if (this.sent.length > this.maxSent) this.sent.shift();
    return { proveedor: this.name, estado: 'SIMULADA', simulada: true, mensajeId };
  }

  /** Lo que se habría enviado a un usuario, del más reciente al más antiguo. */
  sentTo(tenantId, usuarioId) {
    return this.sent.filter((m) => m.tenantId === tenantId && m.usuarioId === usuarioId).reverse();
  }
}

module.exports = MockPushProvider;
