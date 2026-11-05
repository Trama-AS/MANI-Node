const MockPushProvider = require('./MockPushProvider');

// Adaptadores disponibles. El real (FCM/APNs) se agrega aquí cuando exista, sin tocar los casos de uso:
// se elige por configuración de cada ambiente, no con un flag en el código (ADR-0014).
const PROVIDERS = {
  mock: () => new MockPushProvider(),
};

class PushProviderConfigurationError extends Error {}

/**
 * Elige el proveedor push según PUSH_PROVIDER (por omisión `mock`). Un valor sin adaptador detiene el
 * arranque: es preferible a creer que se envían notificaciones reales cuando no es así.
 */
function createPushProvider(name = 'mock') {
  const key = String(name || 'mock').trim().toLowerCase();
  const factory = PROVIDERS[key];
  if (!factory) {
    throw new PushProviderConfigurationError(
      `PUSH_PROVIDER="${name}" no tiene adaptador. Valores disponibles: ${Object.keys(PROVIDERS).join(', ')}.`
    );
  }
  return factory();
}

module.exports = { createPushProvider, PushProviderConfigurationError, PROVIDERS };
