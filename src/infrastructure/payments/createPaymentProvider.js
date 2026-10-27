const MockPaymentProvider = require('./MockPaymentProvider');

// Adaptadores disponibles. El operador certificado (ADR-0023/0024) se agrega aquí cuando exista, sin tocar los casos
// de uso: se elige por configuración de cada ambiente, no con un flag en el código (ADR-0014).
const PROVIDERS = {
  mock: () => new MockPaymentProvider(),
};

class PaymentProviderConfigurationError extends Error {}

/**
 * Elige el proveedor de pagos según PAYMENT_PROVIDER (por omisión `mock`). Un valor sin adaptador detiene el arranque:
 * es preferible a creer que se cobra de verdad cuando no es así.
 */
function createPaymentProvider(name = 'mock') {
  const key = String(name || 'mock').trim().toLowerCase();
  const factory = PROVIDERS[key];
  if (!factory) {
    throw new PaymentProviderConfigurationError(
      `PAYMENT_PROVIDER="${name}" no tiene adaptador. Valores disponibles: ${Object.keys(PROVIDERS).join(', ')}.`
    );
  }
  return factory();
}

module.exports = { createPaymentProvider, PaymentProviderConfigurationError, PROVIDERS };
