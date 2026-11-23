const MockPaymentProvider = require('./MockPaymentProvider');
const HttpSandboxPaymentProvider = require('./HttpSandboxPaymentProvider');

// Adaptadores disponibles. El operador certificado (ADR-0023/0024) se agrega aquí cuando exista, sin tocar los casos
// de uso: se elige por configuración de cada ambiente, no con un flag en el código (ADR-0014).
const PROVIDERS = {
  mock: () => new MockPaymentProvider(),
  // SCRUM-1725 (QAS-26): cobra contra un sandbox por HTTP; necesita PAYMENT_PROVIDER_URL (y PAYMENT_PROVIDER_API_KEY si lo pide).
  sandbox_http: ({ url, apiKey, fetchImpl } = {}) => new HttpSandboxPaymentProvider({ url, apiKey, fetchImpl }),
};

class PaymentProviderConfigurationError extends Error {}

/** `true` si es una URL http(s) con host: se valida con `URL`, sin expresión regular. */
function esUrlHttp(valor) {
  try {
    const u = new URL(String(valor || '').trim());
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname !== '';
  } catch {
    return false;
  }
}

// Adaptadores que no arrancan sin su URL: es preferible detener el arranque a descubrir el hueco en el primer cobro.
const REQUIEREN_URL = new Set(['sandbox_http']);

/**
 * Elige el proveedor de pagos según PAYMENT_PROVIDER (por omisión `mock`). Un valor sin adaptador detiene el arranque:
 * es preferible a creer que se cobra de verdad cuando no es así.
 */
function createPaymentProvider(name = 'mock', { url, apiKey, fetchImpl } = {}) {
  const key = String(name || 'mock').trim().toLowerCase();
  const factory = PROVIDERS[key];
  if (!factory) {
    throw new PaymentProviderConfigurationError(
      `PAYMENT_PROVIDER="${name}" no tiene adaptador. Valores disponibles: ${Object.keys(PROVIDERS).join(', ')}.`
    );
  }
  if (REQUIEREN_URL.has(key) && !esUrlHttp(url)) {
    throw new PaymentProviderConfigurationError(`PAYMENT_PROVIDER="${key}" requiere PAYMENT_PROVIDER_URL con una URL http(s) válida.`);
  }
  return factory({ url: url && String(url).trim(), apiKey, fetchImpl });
}

module.exports = { createPaymentProvider, PaymentProviderConfigurationError, PROVIDERS };
