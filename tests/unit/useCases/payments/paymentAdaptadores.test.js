const test = require('node:test');
const assert = require('node:assert/strict');
const CreatePaymentUseCase = require('../../../../src/application/useCases/payments/CreatePaymentUseCase');
const { createPaymentProvider } = require('../../../../src/infrastructure/payments/createPaymentProvider');
const { crearFakeSandboxPagos } = require('../../../helpers/fakeSandboxPagos');

// SCRUM-1725 (QAS-26): el MISMO caso de uso de cobro corre con cualquiera de los dos adaptadores; solo cambia lo que
// elige `createPaymentProvider` a partir de PAYMENT_PROVIDER. Ni el caso de uso ni sus pruebas conocen el adaptador.

const TENANT = '11111111-1111-4111-8111-111111111111';
const COTIZACION = '33333333-3333-4333-8333-333333333333';
const cliente = { tenantId: TENANT, userId: '22222222-2222-4222-8222-222222222222', role: 'CLIENT' };
const COBRO = { cotizacionId: COTIZACION, solicitudId: 's-1', clienteId: 'c-1', monto: 150000, moneda: 'COP' };

const ADAPTADORES = {
  mock: () => createPaymentProvider('mock'),
  sandbox_http: (fake) => createPaymentProvider('sandbox_http', { url: 'https://sandbox-pagos.example.test', fetchImpl: fake.fetch }),
};

function setup(provider, politica) {
  const registrados = [];
  const paymentRepository = {
    prepararCobro: async () => ({ cobro: COBRO }),
    registrar: async (_ctx, datos) => (registrados.push(datos), { pago: { id: 'p-1', ...datos }, creado: true }),
  };
  const useCase = new CreatePaymentUseCase({ paymentRepository, paymentProvider: provider, politica, auditLogger: () => {} });
  return { useCase, registrados };
}
const pagar = (useCase, body = {}) => useCase.execute({ user: cliente, body: { cotizacionId: COTIZACION, ...body }, correlationId: 'corr-1' });

for (const [nombre, crear] of Object.entries(ADAPTADORES)) {
  test(`[${nombre}] el cobro aprobado se registra con el adaptador que lo resolvió y como simulado`, async () => {
    const { useCase, registrados } = setup(crear(crearFakeSandboxPagos()));
    await pagar(useCase);
    assert.equal(registrados.length, 1);
    assert.equal(registrados[0].proveedor, nombre);
    assert.equal(registrados[0].simulado, true);
    assert.equal(registrados[0].estado, 'APROBADO');
    assert.ok(registrados[0].referenciaProveedor);
  });

  test(`[${nombre}] un pago rechazado queda registrado con su motivo`, async () => {
    const { useCase, registrados } = setup(crear(crearFakeSandboxPagos({ escenario: 'RECHAZADO' })), undefined);
    await pagar(useCase, { escenario: 'RECHAZADO' });
    assert.equal(registrados[0].estado, 'RECHAZADO');
    assert.ok(registrados[0].motivo);
  });
}

test('[sandbox_http] un sandbox caído responde 502 y no deja pago registrado', async () => {
  const fake = crearFakeSandboxPagos();
  const caido = crearFakeSandboxPagos({ respuesta: fake.json(503, {}) });
  const { useCase, registrados } = setup(ADAPTADORES.sandbox_http(caido));
  await assert.rejects(() => pagar(useCase), (err) => err.statusCode === 502 || err.status === 502);
  assert.equal(registrados.length, 0);
});

test('[sandbox_http] un sandbox que no responde a tiempo da 504 y no deja pago registrado', async () => {
  const lento = {
    fetch: (_url, { signal }) =>
      new Promise((_, rechazar) =>
        signal.addEventListener('abort', () => rechazar(Object.assign(new Error('aborted'), { name: 'AbortError' })))
      ),
  };
  const { useCase, registrados } = setup(ADAPTADORES.sandbox_http(lento), { timeoutMs: 20 });
  await assert.rejects(() => pagar(useCase), (err) => err.statusCode === 504 || err.status === 504);
  assert.equal(registrados.length, 0);
});
