const MockPushProvider = require('./MockPushProvider');
const FalibleMockPushProvider = require('./FalibleMockPushProvider');

// Adaptadores disponibles. El real (FCM/APNs) se agrega aquí cuando exista, sin tocar los casos de uso:
// se elige por configuración de cada ambiente, no con un flag en el código (ADR-0014).
const PROVIDERS = {
  mock: () => new MockPushProvider(),
  // Falla inyectable (SCRUM-1662): solo fuera de producción; ver FalibleMockPushProvider.
  mock_falla: ({ fallas } = {}) => new FalibleMockPushProvider({ fallas }),
};

// Adaptadores que existen solo para provocar fallas: prohibidos en producción.
const SOLO_FUERA_DE_PRODUCCION = new Set(['mock_falla']);

class PushProviderConfigurationError extends Error {}

/**
 * Elige el proveedor push según PUSH_PROVIDER (por omisión `mock`). Un valor sin adaptador detiene el
 * arranque: es preferible a creer que se envían notificaciones reales cuando no es así.
 */
function createPushProvider(name = 'mock', { environment = 'development', fallas } = {}) {
  const key = String(name || 'mock').trim().toLowerCase();
  const factory = PROVIDERS[key];
  if (!factory) {
    throw new PushProviderConfigurationError(
      `PUSH_PROVIDER="${name}" no tiene adaptador. Valores disponibles: ${Object.keys(PROVIDERS).join(', ')}.`
    );
  }
  if (SOLO_FUERA_DE_PRODUCCION.has(key) && environment === 'production') {
    throw new PushProviderConfigurationError(`PUSH_PROVIDER="${key}" provoca fallas a propósito y no se permite en producción.`);
  }
  return factory({ fallas });
}

module.exports = { createPushProvider, PushProviderConfigurationError, PROVIDERS };
