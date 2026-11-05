const test = require('node:test');
const assert = require('node:assert/strict');
const MockPaymentProvider = require('../../../src/infrastructure/payments/MockPaymentProvider');
const PaymentProviderError = require('../../../src/domain/errors/PaymentProviderError');
const { createPaymentProvider, PaymentProviderConfigurationError } = require('../../../src/infrastructure/payments/createPaymentProvider');

const cobro = (escenario) => ({ monto: 150000, moneda: 'COP', referencia: 'cot-1', escenario });

test('mock: sin escenario aprueba, con referencia propia y marcado como simulado', async () => {
  const provider = new MockPaymentProvider({ idFactory: () => 'abc' });

  assert.deepEqual(await provider.charge(cobro(undefined)), { estado: 'APROBADO', referencia: 'mock-pay-abc' });
  assert.equal(provider.name, 'mock');
  assert.equal(provider.simulated, true);
});

test('mock: rechazado trae un motivo que dice que es simulado; pendiente no trae motivo', async () => {
  const provider = new MockPaymentProvider({ idFactory: () => 'x' });

  const rechazo = await provider.charge(cobro('RECHAZADO'));
  assert.equal(rechazo.estado, 'RECHAZADO');
  assert.match(rechazo.motivo, /simulado/i);
  assert.deepEqual(await provider.charge(cobro('PENDIENTE')), { estado: 'PENDIENTE', referencia: 'mock-pay-x' });
});

test('mock: el timeout es un fallo del proveedor, no un rechazo', async () => {
  await assert.rejects(
    () => new MockPaymentProvider().charge(cobro('TIMEOUT')),
    (err) => err instanceof PaymentProviderError && err.kind === 'TIMEOUT'
  );
});

test('mock: la respuesta inválida no trae un desenlace ni referencia', async () => {
  const respuesta = await new MockPaymentProvider().charge(cobro('RESPUESTA_INVALIDA'));
  assert.equal(respuesta.referencia, undefined);
  assert.equal(['APROBADO', 'RECHAZADO', 'PENDIENTE'].includes(respuesta.estado), false);
});

test('mock: un escenario desconocido falla en lugar de aprobar por omisión', async () => {
  await assert.rejects(() => new MockPaymentProvider().charge(cobro('REGALO')), (err) => err.kind === 'INVALID_RESPONSE');
});

test('createPaymentProvider: por omisión y con "mock" (sin importar mayúsculas) usa el mock', () => {
  assert.ok(createPaymentProvider() instanceof MockPaymentProvider);
  assert.ok(createPaymentProvider(' MOCK ') instanceof MockPaymentProvider);
});

test('createPaymentProvider: un proveedor sin adaptador detiene el arranque (no se cree que se cobra de verdad)', () => {
  assert.throws(
    () => createPaymentProvider('stripe'),
    (err) => err instanceof PaymentProviderConfigurationError && /PAYMENT_PROVIDER="stripe"/.test(err.message)
  );
});
