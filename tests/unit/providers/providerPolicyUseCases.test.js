const test = require('node:test');
const assert = require('node:assert/strict');
const CreatePaymentUseCase = require('../../../src/application/useCases/payments/CreatePaymentUseCase');
const PublishNotificationUseCase = require('../../../src/application/useCases/dispatch/PublishNotificationUseCase');
const MockPaymentProvider = require('../../../src/infrastructure/payments/MockPaymentProvider');
const MockPushProvider = require('../../../src/infrastructure/push/MockPushProvider');

// SCRUM-1240 (ARQ-09): los casos de uso aplican la política común de proveedores. C2: fallos, timeout y reintento
// sin duplicar pagos ni envíos y sin éxito falso. C3: tenant y destinatario salen de la sesión y quedan auditados.

const TENANT = '11111111-1111-4111-8111-111111111111';
const COTIZACION = '33333333-3333-4333-8333-333333333333';
const CLAVE = '44444444-4444-4444-8444-444444444444';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';
const ALLY = '66666666-6666-4666-8666-666666666666';
const cliente = { tenantId: TENANT, userId: '22222222-2222-4222-8222-222222222222', role: 'CLIENT' };
const COBRO = { cotizacionId: COTIZACION, solicitudId: 's-1', clienteId: 'c-1', monto: 150000, moneda: 'COP' };

const colgado = ({ signal }) =>
  new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('abortado'))));

function pagos(provider, politica = { timeoutMs: 20 }) {
  const calls = { registrar: [], audit: [] };
  const useCase = new CreatePaymentUseCase({
    paymentRepository: {
      prepararCobro: async () => ({ cobro: COBRO }),
      registrar: async (ctx, datos) => (calls.registrar.push(datos), { pago: { id: 'p-1', ...datos }, creado: true }),
    },
    paymentProvider: provider,
    politica,
    auditLogger: (e) => calls.audit.push(e),
  });
  return { useCase, calls };
}

const pagar = (useCase, body = {}) =>
  useCase.execute({ user: cliente, body: { cotizacionId: COTIZACION, ...body }, correlationId: 'corr-pago' });

test('pagos C2: un proveedor colgado responde 504 dentro del timeout, no registra pago y queda auditado', async () => {
  let intentos = 0;
  let senal;
  const provider = Object.assign(new MockPaymentProvider(), {
    charge: (cobro) => {
      intentos += 1;
      senal = cobro.signal;
      return colgado(cobro);
    },
  });
  const { useCase, calls } = pagos(provider);

  const inicio = Date.now();
  await assert.rejects(pagar(useCase), (err) => err.code === 'MANI-PAG-504' && err.statusCode === 504);

  assert.ok(Date.now() - inicio < 3000, 'no espera indefinidamente');
  assert.equal(senal.aborted, true, 'se cancela la espera del proveedor');
  assert.equal(calls.registrar.length, 0, 'sin desenlace no hay pago');
  assert.equal(calls.audit[0].event, 'US-07.pago.proveedor_sin_desenlace');
  assert.equal(calls.audit[0].causa, 'TIMEOUT');
  assert.equal(calls.audit[0].tenant_id, TENANT);
  assert.equal(intentos, 1);
});

test('pagos C2: Core nunca reintenta un cobro, aunque la configuración pida reintentos', async () => {
  let intentos = 0;
  const provider = Object.assign(new MockPaymentProvider(), {
    charge: async () => {
      intentos += 1;
      throw new Error('red caída');
    },
  });
  const { useCase, calls } = pagos(provider, { timeoutMs: 20, retries: 3, baseDelayMs: 0 });

  await assert.rejects(pagar(useCase), { code: 'MANI-PAG-502' });
  assert.equal(intentos, 1);
  assert.equal(calls.registrar.length, 0);
});

test('pagos C2: el proveedor recibe la clave del cliente y el correlationId, y la misma clave no cobra dos veces', async () => {
  const provider = new MockPaymentProvider();
  const recibidos = [];
  const original = provider.charge.bind(provider);
  provider.charge = (cobro) => (recibidos.push(cobro), original(cobro));
  const { useCase, calls } = pagos(provider);

  await pagar(useCase, { claveIdempotencia: CLAVE });
  await pagar(useCase, { claveIdempotencia: CLAVE });

  assert.equal(recibidos[0].idempotencyKey, CLAVE);
  assert.equal(recibidos[0].correlationId, 'corr-pago');
  assert.equal(calls.registrar[0].referenciaProveedor, calls.registrar[1].referenciaProveedor, 'mismo cobro, no dos');
});

test('pagos C2: sin clave del cliente no se inventa una, para que un pago rechazado se pueda reintentar', async () => {
  const provider = new MockPaymentProvider();
  const recibidos = [];
  const original = provider.charge.bind(provider);
  provider.charge = (cobro) => (recibidos.push(cobro), original(cobro));
  const { useCase, calls } = pagos(provider);

  await pagar(useCase, { escenario: 'RECHAZADO' });
  await pagar(useCase);

  assert.equal(recibidos[0].idempotencyKey, undefined);
  assert.equal(calls.registrar[0].estado, 'RECHAZADO');
  assert.equal(calls.registrar[1].estado, 'APROBADO');
});

function publicar(pushProvider, politica = { timeoutMs: 20, baseDelayMs: 0 }) {
  const useCase = new PublishNotificationUseCase({
    notificacionRepository: { createForAlly: async () => ({ id: 'n1', usuarioId: 'u-ally', nueva: true }) },
    pushProvider,
    politica,
  });
  return useCase.execute({
    session: cliente,
    body: { allyId: ALLY, tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload: { requestId: SOLICITUD } },
    correlationId: 'corr-push',
  });
}

test('push C2: un proveedor colgado se reintenta y termina FALLIDA dentro del límite, sin éxito falso', async () => {
  let intentos = 0;
  const provider = Object.assign(new MockPushProvider(), {
    send: (n) => {
      intentos += 1;
      return colgado(n);
    },
  });

  const inicio = Date.now();
  const { entrega } = await publicar(provider);

  assert.ok(Date.now() - inicio < 3000);
  assert.equal(intentos, 3, 'un intento y dos reintentos');
  assert.deepEqual(entrega, { proveedor: 'mock', estado: 'FALLIDA', simulada: true });
});

test('push C2: un fallo pasajero seguido de éxito entrega una sola vez, con la notificación como clave', async () => {
  const provider = new MockPushProvider({ idFactory: () => 'x' });
  const original = provider.send.bind(provider);
  let intentos = 0;
  provider.send = async (n) => {
    intentos += 1;
    // El proveedor alcanza a registrar el envío pero la respuesta se pierde: el reintento no debe duplicarlo.
    await original(n);
    if (intentos === 1) throw new Error('respuesta perdida');
    return original(n);
  };

  const { entrega } = await publicar(provider);

  assert.equal(intentos, 2);
  assert.equal(entrega.estado, 'SIMULADA');
  assert.equal(provider.sentTo(TENANT, 'u-ally').length, 1, 'no se entrega dos veces');
  const [enviado] = provider.sent;
  assert.equal(enviado.idempotencyKey, 'n1');
  assert.equal(enviado.correlationId, 'corr-push');
});

test('push C3: el tenant y el destinatario salen de la sesión y del repositorio, no del cuerpo', async () => {
  const provider = new MockPushProvider();
  await publicar(provider);
  const [enviado] = provider.sent;
  assert.equal(enviado.tenantId, TENANT);
  assert.equal(enviado.usuarioId, 'u-ally');
});
