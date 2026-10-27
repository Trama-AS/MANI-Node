const ProviderError = require('../../domain/errors/ProviderError');

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Política común de llamada a un proveedor externo (SCRUM-1240, ARQ-09). Todo caso de uso que habla con un
 * proveedor de pagos o de notificaciones pasa por aquí, para que el comportamiento ante fallos sea el mismo:
 *
 * - **Timeout:** si el proveedor no responde en `timeoutMs`, se aborta la señal que recibió y se lanza
 *   `TIMEOUT`. Nunca se espera indefinidamente.
 * - **Fallos sin tipo:** una excepción que no es ProviderError (red, bug del adaptador) se convierte en
 *   `UNAVAILABLE`, sin exponer el detalle interno al cliente.
 * - **Reintentos:** solo si `retries > 0` y el fallo es pasajero (`TIMEOUT` o `UNAVAILABLE`). Quien llama solo
 *   pone `retries > 0` cuando la operación es idempotente para el proveedor (misma `idempotencyKey`), así que
 *   repetirla no duplica el efecto. `INVALID_RESPONSE` nunca se reintenta.
 *
 * @template T
 * @param {(opciones: { signal: AbortSignal, intento: number }) => Promise<T>} operacion
 * @param {{
 *   timeoutMs: number,
 *   retries?: number,
 *   baseDelayMs?: number,
 *   ErrorClass?: typeof ProviderError,
 *   proveedor?: string,
 * }} politica
 * @returns {Promise<T>}
 */
async function callProvider(operacion, { timeoutMs, retries = 0, baseDelayMs = 100, ErrorClass = ProviderError, proveedor = 'proveedor' }) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('callProvider: timeoutMs debe ser un número positivo');
  }
  let intento = 1;
  // Cada vuelta termina devolviendo el resultado, lanzando el fallo o esperando para el siguiente intento.
  while (true) {
    try {
      return await conTimeout(operacion, intento, { timeoutMs, ErrorClass, proveedor });
    } catch (err) {
      const fallo = err instanceof ProviderError ? err : new ErrorClass('UNAVAILABLE', `${proveedor} no está disponible`);
      if (!fallo.transient || intento > retries) throw fallo;
      await esperar(baseDelayMs * 2 ** (intento - 1));
      intento += 1;
    }
  }
}

async function conTimeout(operacion, intento, { timeoutMs, ErrorClass, proveedor }) {
  const controlador = new AbortController();
  const errorDeTimeout = () => new ErrorClass('TIMEOUT', `${proveedor} no respondió en ${timeoutMs} ms`);
  let temporizador;
  // Al abortar, el adaptador suele rechazar con su propio error antes que esta promesa. La marca evita que ese
  // rechazo se informe como UNAVAILABLE: si venció el plazo, el desenlace es TIMEOUT.
  let vencio = false;
  const vencido = new Promise((_, reject) => {
    temporizador = setTimeout(() => {
      vencio = true;
      reject(errorDeTimeout());
      controlador.abort();
    }, timeoutMs);
  });
  try {
    return await Promise.race([operacion({ signal: controlador.signal, intento }), vencido]);
  } catch (err) {
    throw vencio ? errorDeTimeout() : err;
  } finally {
    clearTimeout(temporizador);
  }
}

module.exports = callProvider;
