/**
 * Política de entrega push con un techo de tiempo total (SCRUM-1662, QAS-02). Quien origina la operación no espera más de
 * `techoMs` entre todos los intentos y las pausas: el techo se reparte entre los intentos, así reintentar no alarga la
 * respuesta cuando el proveedor tarda. Cada intento dura al menos 250 ms y entre intentos hay una pausa corta.
 *
 * Existe porque la oferta de despacho llegaba a esperar 3 intentos de 5 s (15 s) mientras Dispatch corta cada llamada a
 * Core a los 10 s (`ClientesDeCore.Espera`): la orquestación respondía 503 y dejaba 1 de 2 ofertas.
 *
 * @param {{ timeoutMs: number, retries: number, techoMs: number, baseDelayMs?: number }} config
 * @returns {{ timeoutMs: number, retries: number, baseDelayMs: number }}
 */
function politicaPushConTecho({ timeoutMs, retries, techoMs, baseDelayMs = 50 }) {
  const reintentos = Number.isInteger(retries) && retries > 0 ? retries : 0;
  const total = Math.min(timeoutMs, techoMs);
  return { timeoutMs: Math.max(250, Math.floor(total / (reintentos + 1))), retries: reintentos, baseDelayMs };
}

/** Peor caso de espera de una política (todos los intentos agotan su plazo, con las pausas entre ellos), en ms. */
function esperaMaximaMs({ timeoutMs, retries = 0, baseDelayMs = 100 }) {
  let pausas = 0;
  for (let i = 0; i < retries; i += 1) pausas += baseDelayMs * 2 ** i;
  return timeoutMs * (retries + 1) + pausas;
}

module.exports = { politicaPushConTecho, esperaMaximaMs };
