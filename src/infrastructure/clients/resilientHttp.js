const { DomainError } = require('../../domain/errors/DomainError');
const CircuitBreaker = require('../../application/providers/CircuitBreaker');

/**
 * Piezas comunes de los clientes HTTP de Core hacia otros servicios internos (Dispatch, Rules):
 * configuración, circuit breaker, reintentos y espera por petición (SCRUM-1658, SCRUM-1663).
 *
 * Cada cliente conserva lo que es suyo: la ruta, los encabezados y cómo interpreta la respuesta.
 * Un DomainError es una respuesta del servicio (contrato, 4xx), no una caída: no reintenta ni abre
 * el circuito.
 */

/** Estados que indican que el servicio puede responder en el siguiente intento. */
const RETRYABLE_STATUS = new Set([502, 503, 504]);

/**
 * Configuración común del cliente: base, espera, reintentos, fetch y circuit breaker propio
 * (o el que se inyecte, en pruebas).
 */
function configurarCliente(
  nombreServicio,
  {
    baseUrl,
    timeoutMs = 3000,
    retries = 1,
    fetchImpl = globalThis.fetch,
    circuitBreaker = null,
    failureThreshold = 5,
    resetTimeoutMs = 10000,
  } = {}
) {
  return {
    baseUrl,
    timeoutMs,
    retries,
    fetchImpl,
    circuitBreaker:
      circuitBreaker ||
      new CircuitBreaker(null, {
        name: nombreServicio,
        failureThreshold,
        resetTimeoutMs,
        errorFilter: (err) => !(err instanceof DomainError),
      }),
  };
}

/**
 * Ejecuta `intento` dentro del circuit breaker, reintentando solo las fallas marcadas como
 * `retryable`. Una falla que no es DomainError se convierte con `noDisponible` (503).
 */
async function ejecutarConReintentos({ circuitBreaker, retries }, intento, noDisponible) {
  try {
    return await circuitBreaker.execute(async () => {
      let lastError;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          return await intento();
        } catch (err) {
          if (err instanceof DomainError) throw err;
          lastError = err;
          if (!err.retryable) break;
        }
      }
      throw lastError;
    });
  } catch (err) {
    if (err instanceof DomainError) throw err;
    throw noDisponible(err.message);
  }
}

/** fetch a `baseUrl + path` con la espera del cliente; sin respuesta es una falla reintentable. */
async function enviarConEspera({ baseUrl, fetchImpl, timeoutMs }, path, request) {
  try {
    return await fetchImpl(`${baseUrl.replace(/\/$/, '')}${path}`, {
      ...request,
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    const reason = err.name === 'TimeoutError' ? `sin respuesta en ${timeoutMs} ms` : err.message;
    throw Object.assign(new Error(reason), { retryable: true });
  }
}

/** Un 5xx del servicio: se reintenta solo si es 502, 503 o 504. */
function errorDeServidor(status) {
  return Object.assign(new Error(`respondió ${status}`), { retryable: RETRYABLE_STATUS.has(status) });
}

/** Un 4xx del servicio es una falla de integración entre servicios (502), no un dato del usuario. */
async function errorDeContrato(response, nombreServicio, codigo) {
  const body = await response.json().catch(() => ({}));
  return new DomainError(
    `El servicio de ${nombreServicio} rechazó la petición (${response.status} ${body.code || ''}): ${body.error || ''}`.trim(),
    codigo,
    502
  );
}

module.exports = {
  RETRYABLE_STATUS,
  configurarCliente,
  ejecutarConReintentos,
  enviarConEspera,
  errorDeServidor,
  errorDeContrato,
};
