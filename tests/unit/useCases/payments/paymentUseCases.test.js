const test = require('node:test');
const assert = require('node:assert/strict');
const CreatePaymentUseCase = require('../../../../src/application/useCases/payments/CreatePaymentUseCase');
const GetPaymentUseCase = require('../../../../src/application/useCases/payments/GetPaymentUseCase');
const MockPaymentProvider = require('../../../../src/infrastructure/payments/MockPaymentProvider');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const COTIZACION = '33333333-3333-4333-8333-333333333333';
const CLAVE = '44444444-4444-4444-8444-444444444444';
const cliente = { tenantId: TENANT, userId: USER, role: 'CLIENT' };

const COBRO = { cotizacionId: COTIZACION, solicitudId: 's-1', clienteId: 'c-1', monto: 150000, moneda: 'COP' };

function setup({ preparado = { cobro: COBRO }, provider = new MockPaymentProvider({ idFactory: () => 'x' }) } = {}) {
  const calls = { preparar: [], registrar: [], audit: [] };
  const paymentRepository = {
    prepararCobro: async (ctx, datos) => (calls.preparar.push([ctx, datos]), preparado),
    registrar: async (ctx, datos) => {
      calls.registrar.push([ctx, datos]);
      return { pago: { id: 'p-1', ...datos, creadoEn: new Date('2026-10-26T20:00:00Z') }, creado: true };
    },
  };
  const useCase = new CreatePaymentUseCase({ paymentRepository, paymentProvider: provider, auditLogger: (e) => calls.audit.push(e) });
  return { useCase, calls };
}

const pagar = (useCase, body = {}, user = cliente) =>
  useCase.execute({ user, body: { cotizacionId: COTIZACION, ...body }, correlationId: 'corr-1' });

// ---- C1: pago simulado exitoso, identificado como simulado ----

test('C1: un pago aprobado se registra con el monto de la cotización, el proveedor y la marca de simulado', async () => {
  const { useCase, calls } = setup();

  const { pago, creado } = await pagar(useCase);

  assert.equal(creado, true);
  const [ctx, datos] = calls.registrar[0];
  assert.deepEqual(ctx, cliente);
  assert.equal(datos.monto, 150000, 'el monto sale de la cotización');
  assert.equal(datos.estado, 'APROBADO');
  assert.equal(datos.proveedor, 'mock');
  assert.equal(datos.simulado, true);
  assert.equal(datos.referenciaProveedor, 'mock-pay-x');
  assert.equal(datos.correlationId, 'corr-1');
  assert.equal(pago.id, 'p-1');
});

test('C1: rechazado y pendiente son desenlaces válidos y se registran con su motivo', async () => {
  for (const [escenario, estado] of [['RECHAZADO', 'RECHAZADO'], ['PENDIENTE', 'PENDIENTE']]) {
    const { useCase, calls } = setup();
    await pagar(useCase, { escenario });
    assert.equal(calls.registrar[0][1].estado, estado);
  }
  const { useCase, calls } = setup();
  await pagar(useCase, { escenario: 'RECHAZADO' });
  assert.match(calls.registrar[0][1].motivo, /simulado/i);
});

test('C1: la clave de idempotencia se pasa al repositorio, y un reintento devuelve el pago existente sin cobrar', async () => {
  const { useCase, calls } = setup();
  await pagar(useCase, { claveIdempotencia: CLAVE });
  assert.equal(calls.preparar[0][1].claveIdempotencia, CLAVE);
  assert.equal(calls.registrar[0][1].claveIdempotencia, CLAVE);

  const existente = { id: 'p-0', estado: 'APROBADO' };
  const reintento = setup({ preparado: { existente } });
  const resultado = await pagar(reintento.useCase, { claveIdempotencia: CLAVE });
  assert.deepEqual(resultado, { pago: existente, creado: false });
  assert.equal(reintento.calls.registrar.length, 0);
});

// ---- C2: fallo, timeout o respuesta inválida no marcan pago exitoso ----

test('C2: un timeout del proveedor responde 504 accionable, no registra nada y queda auditado', async () => {
  const { useCase, calls } = setup();

  await assert.rejects(
    () => pagar(useCase, { escenario: 'TIMEOUT' }),
    (err) => err.statusCode === 504 && err.code === 'MANI-PAG-504' && /No se realizó ningún cobro/.test(err.message)
  );
  assert.equal(calls.registrar.length, 0);
  assert.equal(calls.audit[0].event, 'US-07.pago.proveedor_sin_desenlace');
  assert.equal(calls.audit[0].causa, 'TIMEOUT');
  assert.equal(calls.audit[0].correlation_id, 'corr-1');
});

test('C2: una respuesta inválida del proveedor responde 502 y no registra ningún pago', async () => {
  const { useCase, calls } = setup();

  await assert.rejects(() => pagar(useCase, { escenario: 'RESPUESTA_INVALIDA' }), (err) => err.statusCode === 502 && err.code === 'MANI-PAG-502');
  assert.equal(calls.registrar.length, 0);
});

test('C2: un proveedor que devuelve un desenlace fuera del contrato, o sin referencia, nunca se toma como éxito', async () => {
  for (const respuesta of [null, {}, { estado: 'APROBADO' }, { estado: 'APROBADO', referencia: ' ' }, { estado: 'OK', referencia: 'r' }]) {
    const { useCase, calls } = setup({ provider: { name: 'x', simulated: true, charge: async () => respuesta } });
    await assert.rejects(() => pagar(useCase), (err) => err.statusCode === 502, JSON.stringify(respuesta));
    assert.equal(calls.registrar.length, 0);
  }
});

test('C2: un proveedor caído (cualquier excepción) responde 502 y no registra', async () => {
  const { useCase, calls } = setup({
    provider: { name: 'x', simulated: true, charge: async () => { throw new Error('ECONNRESET'); } },
  });
  await assert.rejects(() => pagar(useCase), (err) => err.statusCode === 502);
  assert.equal(calls.registrar.length, 0);
});

// ---- C3 y validaciones: identidad del JWT, sin datos de tarjeta ----

test('C3: solo un cliente con sesión paga; aliado o admin reciben 403 y sin sesión 401, sin tocar el repositorio', async () => {
  for (const role of ['ALLY', 'ADMIN']) {
    const { useCase, calls } = setup();
    await assert.rejects(() => pagar(useCase, {}, { ...cliente, role }), (err) => err.statusCode === 403);
    assert.equal(calls.preparar.length, 0);
  }
  const { useCase } = setup();
  for (const user of [null, {}, { tenantId: TENANT, userId: 'no-es-uuid', role: 'CLIENT' }]) {
    await assert.rejects(() => pagar(useCase, {}, user), (err) => err.statusCode === 401);
  }
});

test('C3: el tenant, el cliente y el rol salen de la sesión aunque el cuerpo traiga otros', async () => {
  const { useCase, calls } = setup();
  await pagar(useCase, { tenantId: 'otro', clienteId: 'otro', userId: 'otro', role: 'ADMIN', monto: 1 });
  assert.deepEqual(calls.preparar[0][0], cliente);
  assert.equal(calls.registrar[0][1].monto, 150000, 'un monto en el cuerpo se ignora');
});

test('el sandbox rechaza cualquier dato de tarjeta en el cuerpo y no consulta nada', async () => {
  for (const campo of ['numeroTarjeta', 'cardNumber', 'cvv', 'CVC', 'fechaExpiracion', 'tarjeta']) {
    const { useCase, calls } = setup();
    await assert.rejects(() => pagar(useCase, { [campo]: '4111111111111111' }), (err) => err.statusCode === 400 && /sandbox/.test(err.message));
    assert.equal(calls.preparar.length, 0);
  }
});

test('valida el id de la cotización y la clave de idempotencia', async () => {
  const { useCase } = setup();
  await assert.rejects(() => useCase.execute({ user: cliente, body: { cotizacionId: 'x' } }), (err) => err.statusCode === 400);
  await assert.rejects(() => useCase.execute({ user: cliente, body: {} }), (err) => err.statusCode === 400);
  await assert.rejects(() => pagar(useCase, { claveIdempotencia: 'no-uuid' }), (err) => err.statusCode === 400);
});

test('exige repositorio y proveedor', () => {
  assert.throws(() => new CreatePaymentUseCase({ paymentProvider: {} }), /paymentRepository/);
  assert.throws(() => new CreatePaymentUseCase({ paymentRepository: {} }), /paymentProvider/);
  assert.throws(() => new GetPaymentUseCase({}), /paymentRepository/);
});

// ---- Consulta y comprobante ----

const PAGO_ID = '55555555-5555-4555-8555-555555555555';
const pagoAprobado = {
  id: PAGO_ID, cotizacionId: COTIZACION, monto: 150000, moneda: 'COP', estado: 'APROBADO', proveedor: 'mock',
  simulado: true, referenciaProveedor: 'mock-pay-x', creadoEn: new Date('2026-10-26T20:00:00Z'),
};

function consulta(pago) {
  const calls = [];
  const useCase = new GetPaymentUseCase({ paymentRepository: { obtener: async (...a) => (calls.push(a), pago) } });
  return { useCase, calls };
}

test('C1: el comprobante de un pago aprobado se identifica como simulado y sin valor fiscal', async () => {
  const { useCase, calls } = consulta(pagoAprobado);

  const c = await useCase.comprobante({ user: cliente, pagoId: PAGO_ID });

  assert.equal(c.simulado, true);
  assert.match(c.numero, /^SIM-55555555$/);
  assert.match(c.leyenda, /SANDBOX/);
  assert.match(c.leyenda, /SIN VALOR CONTABLE NI FISCAL/);
  assert.equal(c.monto, 150000);
  assert.equal(c.fecha, '2026-10-26T20:00:00.000Z');
  assert.deepEqual(calls[0], [cliente, PAGO_ID]);
});

test('un pago rechazado o pendiente no tiene comprobante (409)', async () => {
  for (const estado of ['RECHAZADO', 'PENDIENTE']) {
    const { useCase } = consulta({ ...pagoAprobado, estado });
    await assert.rejects(() => useCase.comprobante({ user: cliente, pagoId: PAGO_ID }), (err) => err.statusCode === 409 && err.code === 'MANI-PAG-409C');
  }
});

test('C3: solo el cliente consulta; un id inválido responde 400 sin consultar', async () => {
  const { useCase, calls } = consulta(pagoAprobado);
  await assert.rejects(() => useCase.obtener({ user: { ...cliente, role: 'ALLY' }, pagoId: PAGO_ID }), (err) => err.statusCode === 403);
  await assert.rejects(() => useCase.obtener({ user: cliente, pagoId: 'x' }), (err) => err.statusCode === 400);
  assert.equal(calls.length, 0);
});
