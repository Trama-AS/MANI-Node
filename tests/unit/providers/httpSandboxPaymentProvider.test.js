const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const HttpSandboxPaymentProvider = require('../../../src/infrastructure/payments/HttpSandboxPaymentProvider');
const IPaymentProvider = require('../../../src/domain/ports/IPaymentProvider');
const PaymentProviderError = require('../../../src/domain/errors/PaymentProviderError');
const { createPaymentProvider, PaymentProviderConfigurationError } = require('../../../src/infrastructure/payments/createPaymentProvider');
const { crearFakeSandboxPagos } = require('../../helpers/fakeSandboxPagos');

// SCRUM-1725 (QAS-26): segundo adaptador de pagos. El contrato común está en providers.contract.test.js; aquí van sus
// particularidades: lo que envía al sandbox, cómo traduce cada falla y que la fábrica lo elige por configuración.

const URL_SANDBOX = 'https://sandbox-pagos.example.test/';
const cobro = (extra = {}) => ({ monto: 150000, moneda: 'COP', referencia: 'cot-1', idempotencyKey: 'k-1', correlationId: 'corr-1', ...extra });
const crear = (fake, extra = {}) => new HttpSandboxPaymentProvider({ url: URL_SANDBOX, fetchImpl: fake.fetch, ...extra });

async function falla(promesa) {
  try {
    await promesa;
  } catch (err) {
    return err;
  }
  assert.fail('debía fallar');
}

describe('HttpSandboxPaymentProvider', () => {
  test('envía el cobro con la clave de idempotencia, la correlación y sin datos de tarjeta', async () => {
    const fake = crearFakeSandboxPagos();
    await crear(fake, { apiKey: 'secreto-123' }).charge(cobro());

    const [p] = fake.peticiones;
    assert.equal(p.url, 'https://sandbox-pagos.example.test/cobros');
    assert.equal(p.method, 'POST');
    assert.equal(p.headers['Idempotency-Key'], 'k-1');
    assert.equal(p.headers['X-Correlation-ID'], 'corr-1');
    assert.equal(p.headers.Authorization, 'Bearer secreto-123');
    assert.deepEqual(p.cuerpo, { monto: 150000, moneda: 'COP', referencia: 'cot-1' });
  });

  test('sin credencial no manda Authorization', async () => {
    const fake = crearFakeSandboxPagos();
    await crear(fake).charge(cobro());
    assert.equal('Authorization' in fake.peticiones[0].headers, false);
  });

  test('es simulado y se identifica como sandbox_http', () => {
    const p = crear(crearFakeSandboxPagos());
    assert.ok(p instanceof IPaymentProvider);
    assert.equal(p.name, 'sandbox_http');
    assert.equal(p.simulated, true);
  });

  test('un pago rechazado es un desenlace válido y trae su motivo', async () => {
    const r = await crear(crearFakeSandboxPagos({ escenario: 'RECHAZADO' })).charge(cobro());
    assert.equal(r.estado, 'RECHAZADO');
    assert.match(r.motivo, /Fondos insuficientes/);
  });

  test('pendiente se devuelve tal cual, sin presentarlo como aprobado', async () => {
    const r = await crear(crearFakeSandboxPagos({ escenario: 'PENDIENTE' })).charge(cobro());
    assert.equal(r.estado, 'PENDIENTE');
  });

  test('una señal abortada es TIMEOUT', async () => {
    const control = new AbortController();
    control.abort();
    const err = await falla(crear(crearFakeSandboxPagos()).charge(cobro({ signal: control.signal })));
    assert.ok(err instanceof PaymentProviderError);
    assert.equal(err.kind, 'TIMEOUT');
  });

  test('una caída de red es UNAVAILABLE y no filtra el detalle interno ni la credencial', async () => {
    const fake = { fetch: async () => { throw new Error('connect ECONNREFUSED 10.0.0.5:443 Bearer secreto-123'); } };
    const err = await falla(crear(fake, { apiKey: 'secreto-123' }).charge(cobro()));
    assert.equal(err.kind, 'UNAVAILABLE');
    assert.doesNotMatch(err.message, /10\.0\.0\.5|secreto-123|ECONNREFUSED/);
  });

  test('408 y 504 son TIMEOUT; 429 y 5xx son UNAVAILABLE', async () => {
    for (const [status, kind] of [[408, 'TIMEOUT'], [504, 'TIMEOUT'], [429, 'UNAVAILABLE'], [500, 'UNAVAILABLE'], [503, 'UNAVAILABLE']]) {
      const fake = crearFakeSandboxPagos();
      fake.respuesta = null;
      const f = crearFakeSandboxPagos({ respuesta: fake.json(status, {}) });
      const err = await falla(crear(f).charge(cobro()));
      assert.equal(err.kind, kind, `HTTP ${status}`);
    }
  });

  test('un 4xx o un cuerpo fuera del contrato es INVALID_RESPONSE, nunca un éxito', async () => {
    const f0 = crearFakeSandboxPagos();
    const casos = [
      f0.json(400, { error: 'x' }),
      f0.json(200, { estado: 'DESCONOCIDO', referencia: 'r' }),
      f0.json(200, { estado: 'APROBADO' }),
      f0.json(200, { estado: 'APROBADO', referencia: '   ' }),
      f0.json(200, null),
      { status: 200, ok: true, json: async () => { throw new Error('no es json'); } },
    ];
    for (const respuesta of casos) {
      const err = await falla(crear(crearFakeSandboxPagos({ respuesta })).charge(cobro()));
      assert.equal(err.kind, 'INVALID_RESPONSE');
    }
  });

  test('requiere URL', () => {
    assert.throws(() => new HttpSandboxPaymentProvider({ fetchImpl: () => {} }), /url/);
  });
});

describe('createPaymentProvider: cambiar de adaptador es solo configuración', () => {
  test('PAYMENT_PROVIDER elige el adaptador sin tocar código', () => {
    const fake = crearFakeSandboxPagos();
    assert.equal(createPaymentProvider('mock').name, 'mock');
    assert.equal(createPaymentProvider('sandbox_http', { url: URL_SANDBOX, fetchImpl: fake.fetch }).name, 'sandbox_http');
    assert.equal(createPaymentProvider('  SANDBOX_HTTP ', { url: URL_SANDBOX, fetchImpl: fake.fetch }).name, 'sandbox_http');
  });

  test('sandbox_http sin URL válida detiene el arranque', () => {
    for (const url of [undefined, '', '   ', 'sandbox-pagos', 'ftp://x']) {
      assert.throws(() => createPaymentProvider('sandbox_http', { url }), PaymentProviderConfigurationError);
    }
  });

  test('un valor sin adaptador sigue deteniendo el arranque y lista los disponibles', () => {
    assert.throws(() => createPaymentProvider('stripe'), /mock, sandbox_http/);
  });
});
