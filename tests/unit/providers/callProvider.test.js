const test = require('node:test');
const assert = require('node:assert/strict');
const callProvider = require('../../../src/application/providers/callProvider');
const ProviderError = require('../../../src/domain/errors/ProviderError');
const PaymentProviderError = require('../../../src/domain/errors/PaymentProviderError');
const PushProviderError = require('../../../src/domain/errors/PushProviderError');

// SCRUM-1240 (ARQ-09): política común de timeout, reintento y fallos para proveedores externos.

const politica = { timeoutMs: 20, baseDelayMs: 0 };
const colgado = ({ signal }) =>
  new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('abortado'))));

test('devuelve el resultado del proveedor y le pasa una señal de cancelación y el número de intento', async () => {
  let recibido;
  const resultado = await callProvider(async (opciones) => {
    recibido = opciones;
    return { ok: true };
  }, politica);

  assert.deepEqual(resultado, { ok: true });
  assert.ok(recibido.signal instanceof AbortSignal);
  assert.equal(recibido.intento, 1);
});

test('C2: si el proveedor no responde a tiempo, aborta la señal y lanza TIMEOUT con la clase pedida', async () => {
  let senal;
  await assert.rejects(
    callProvider(
      (opciones) => {
        senal = opciones.signal;
        return colgado(opciones);
      },
      { ...politica, ErrorClass: PaymentProviderError, proveedor: 'Pasarela X' }
    ),
    (err) => err instanceof PaymentProviderError && err.kind === 'TIMEOUT' && /Pasarela X no respondió en 20 ms/.test(err.message)
  );
  assert.equal(senal.aborted, true);
});

test('C2: una excepción sin tipo se informa como UNAVAILABLE, sin filtrar el mensaje interno', async () => {
  await assert.rejects(
    callProvider(async () => {
      throw new Error('ECONNREFUSED pasarela-interna detalle-reservado');
    }, { ...politica, ErrorClass: PushProviderError }),
    (err) =>
      err instanceof PushProviderError && err.kind === 'UNAVAILABLE' && !/detalle-reservado|ECONNREFUSED/.test(err.message)
  );
});

test('C2: sin reintentos configurados, un fallo pasajero se intenta una sola vez', async () => {
  let intentos = 0;
  await assert.rejects(
    callProvider(async () => {
      intentos += 1;
      throw new ProviderError('UNAVAILABLE');
    }, politica),
    { kind: 'UNAVAILABLE' }
  );
  assert.equal(intentos, 1);
});

test('C2: con reintentos, un fallo pasajero se repite y el primer éxito se devuelve una sola vez', async () => {
  const intentos = [];
  const resultado = await callProvider(
    async ({ intento }) => {
      intentos.push(intento);
      if (intento < 3) throw new ProviderError(intento === 1 ? 'TIMEOUT' : 'UNAVAILABLE');
      return 'entregado';
    },
    { ...politica, retries: 2 }
  );
  assert.equal(resultado, 'entregado');
  assert.deepEqual(intentos, [1, 2, 3]);
});

test('C2: agotados los reintentos se lanza el último fallo, no un éxito', async () => {
  let intentos = 0;
  await assert.rejects(
    callProvider(
      (opciones) => {
        intentos += 1;
        return colgado(opciones);
      },
      { ...politica, retries: 2 }
    ),
    { kind: 'TIMEOUT' }
  );
  assert.equal(intentos, 3);
});

test('C2: una respuesta fuera de contrato (INVALID_RESPONSE) nunca se reintenta', async () => {
  let intentos = 0;
  await assert.rejects(
    callProvider(async () => {
      intentos += 1;
      throw new ProviderError('INVALID_RESPONSE');
    }, { ...politica, retries: 3 }),
    { kind: 'INVALID_RESPONSE' }
  );
  assert.equal(intentos, 1);
});

test('la espera entre reintentos crece de forma exponencial', async () => {
  const inicio = Date.now();
  await callProvider(
    async ({ intento }) => {
      if (intento < 3) throw new ProviderError('UNAVAILABLE');
      return 'ok';
    },
    { timeoutMs: 1000, retries: 2, baseDelayMs: 20 }
  );
  assert.ok(Date.now() - inicio >= 55, 'espera 20 ms y luego 40 ms');
});

test('exige un timeout positivo: no se permite esperar indefinidamente', async () => {
  for (const timeoutMs of [undefined, 0, -1, Number.POSITIVE_INFINITY]) {
    await assert.rejects(callProvider(async () => 'ok', { timeoutMs }), TypeError);
  }
});

test('los puertos base obligan a cada adaptador a declarar name, simulated y la operación', async () => {
  const IPaymentProvider = require('../../../src/domain/ports/IPaymentProvider');
  const IPushProvider = require('../../../src/domain/ports/IPushProvider');
  const pagos = new IPaymentProvider();
  const push = new IPushProvider();
  assert.throws(() => pagos.name, /name no implementada/);
  assert.throws(() => pagos.simulated, /simulated no implementada/);
  await assert.rejects(pagos.charge({}), /charge\(\) no implementado/);
  assert.throws(() => push.name, /name no implementada/);
  assert.throws(() => push.simulated, /simulated no implementada/);
  await assert.rejects(push.send({}), /send\(\) no implementado/);
});

test('ProviderError: solo acepta los tres tipos del contrato y marca como pasajeros TIMEOUT y UNAVAILABLE', () => {
  assert.throws(() => new ProviderError('RECHAZADO'), TypeError);
  assert.equal(new ProviderError('TIMEOUT').transient, true);
  assert.equal(new ProviderError('UNAVAILABLE').transient, true);
  assert.equal(new ProviderError('INVALID_RESPONSE').transient, false);
  assert.ok(new PaymentProviderError('TIMEOUT') instanceof ProviderError);
  assert.equal(new PaymentProviderError('TIMEOUT').name, 'PaymentProviderError');
  assert.ok(new PushProviderError('UNAVAILABLE') instanceof ProviderError);
});
