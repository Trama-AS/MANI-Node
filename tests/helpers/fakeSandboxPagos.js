/**
 * Doble del sandbox de pagos por HTTP (SCRUM-1725): un `fetch` en memoria que se comporta como el sandbox real
 * prometido por el contrato — idempotente por `Idempotency-Key`, un desenlace por cobro — y deja ver cada petición.
 * `escenario` fija el desenlace; `respuesta` reemplaza la respuesta completa para probar fallas.
 */
function crearFakeSandboxPagos({ escenario = 'APROBADO', respuesta } = {}) {
  const peticiones = [];
  const porClave = new Map();
  let contador = 0;

  const json = (status, cuerpo) => ({ status, ok: status >= 200 && status < 300, json: async () => cuerpo });

  async function fakeFetch(url, opts = {}) {
    peticiones.push({ url, ...opts, cuerpo: opts.body ? JSON.parse(opts.body) : undefined });
    if (opts.signal?.aborted) {
      const err = new Error('aborted');
      err.name = 'AbortError';
      throw err;
    }
    if (respuesta) return typeof respuesta === 'function' ? respuesta(url, opts) : respuesta;
    const clave = opts.headers?.['Idempotency-Key'];
    if (clave && porClave.has(clave)) return json(200, porClave.get(clave));
    contador += 1;
    const desenlace = { estado: escenario, referencia: `sbx-pay-${contador}` };
    if (escenario === 'RECHAZADO') desenlace.motivo = 'Fondos insuficientes (sandbox)';
    if (clave) porClave.set(clave, desenlace);
    return json(200, desenlace);
  }

  return { fetch: fakeFetch, peticiones, json };
}

module.exports = { crearFakeSandboxPagos };
