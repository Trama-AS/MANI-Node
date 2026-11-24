const test = require('node:test');
const assert = require('node:assert/strict');
const CircuitBreaker = require('../../../src/application/providers/CircuitBreaker');
const callProvider = require('../../../src/application/providers/callProvider');
const ProviderError = require('../../../src/domain/errors/ProviderError');
const RulesServiceHttpClient = require('../../../src/infrastructure/clients/RulesServiceHttpClient');
const DispatchServiceHttpClient = require('../../../src/infrastructure/clients/DispatchServiceHttpClient');
const { conCorrelationId } = require('../../../src/infrastructure/observability/logger');

test('SCRUM-1663 (QAS-40): CircuitBreaker abre tras alcanzar failureThreshold, rechaza rápido en OPEN y se recupera en HALF_OPEN', async () => {
  let reloj = 1000;
  const eventos = [];
  const cb = new CircuitBreaker(null, {
    name: 'test-service',
    failureThreshold: 3,
    resetTimeoutMs: 5000,
    now: () => reloj,
  });
  cb.on('open', (s) => eventos.push(`open:${s.failures}`))
    .on('halfOpen', () => eventos.push('halfOpen'))
    .on('close', () => eventos.push('close'));

  assert.equal(cb.closed, true);
  assert.equal(cb.opened, false);

  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(() => cb.fire(async () => {
      throw new Error('caída');
    }), /caída/);
  }

  assert.equal(cb.opened, true);
  assert.equal(cb.state, 'OPEN');

  // Mientras está OPEN no invoca la operación y rechaza de inmediato con CIRCUIT_OPEN
  let invocada = false;
  await assert.rejects(
    () => cb.fire(async () => {
      invocada = true;
      return 'ok';
    }),
    (err) => err.code === 'CIRCUIT_OPEN' && err.circuitOpen === true
  );
  assert.equal(invocada, false);

  // Avanza el reloj más allá de resetTimeoutMs -> pasa a HALF_OPEN
  reloj += 5000;
  assert.equal(cb.halfOpen, true);

  // Si falla en HALF_OPEN vuelve a OPEN de inmediato
  await assert.rejects(() => cb.fire(async () => {
    throw new Error('sigue caído');
  }), /sigue caído/);
  assert.equal(cb.opened, true);

  // Avanza de nuevo -> HALF_OPEN y ahora responde bien -> vuelve a CLOSED
  reloj += 5000;
  const res = await cb.fire(async () => 'recuperado');
  assert.equal(res, 'recuperado');
  assert.equal(cb.closed, true);
  assert.equal(cb.stats.failures, 0);
  assert.deepEqual(eventos, ['open:3', 'halfOpen', 'open:4', 'halfOpen', 'close']);
});

test('SCRUM-1663: CircuitBreaker valida sus parámetros y soporta acción por defecto en constructor', async () => {
  assert.throws(() => new CircuitBreaker(null, { failureThreshold: 0 }), TypeError);
  assert.throws(() => new CircuitBreaker(null, { resetTimeoutMs: 0 }), TypeError);

  const cbSinAccion = new CircuitBreaker();
  await assert.rejects(() => cbSinAccion.fire('no-fn'), TypeError);

  const cbConAccion = new CircuitBreaker(async (x) => x * 2, { name: 'doble' });
  assert.equal(await cbConAccion.fire(21), 42);
});

test('SCRUM-1663: callProvider con CircuitBreaker traduce circuito abierto a ProviderError UNAVAILABLE', async () => {
  const cb = new CircuitBreaker(null, { failureThreshold: 2, resetTimeoutMs: 10000 });

  for (let i = 0; i < 2; i += 1) {
    await assert.rejects(
      () => callProvider(async () => {
        throw new ProviderError('UNAVAILABLE', 'caído');
      }, { timeoutMs: 200, retries: 0, proveedor: 'pagos', circuitBreaker: cb }),
      (err) => err instanceof ProviderError && err.kind === 'UNAVAILABLE'
    );
  }

  assert.equal(cb.opened, true);

  let llamadaEnOpen = false;
  await assert.rejects(
    () => callProvider(async () => {
      llamadaEnOpen = true;
      return 'ok';
    }, { timeoutMs: 200, retries: 0, proveedor: 'pagos', circuitBreaker: cb }),
    (err) => err instanceof ProviderError && err.kind === 'UNAVAILABLE' && /circuito abierto/.test(err.message)
  );
  assert.equal(llamadaEnOpen, false);
});

test('SCRUM-1658 / SCRUM-1663: RulesServiceHttpClient y DispatchServiceHttpClient propagan correlationId del contexto y abren circuito tras fallas repetidas', async () => {
  const recibidosRules = [];
  const rulesClient = new RulesServiceHttpClient({
    baseUrl: 'http://rules.internal',
    retries: 0,
    failureThreshold: 2,
    resetTimeoutMs: 60000,
    fetchImpl: async (_url, opts) => {
      recibidosRules.push(opts.headers['X-Correlation-ID']);
      return { ok: false, status: 503, json: async () => ({}) };
    },
  });

  await conCorrelationId('corr-distribuido-99', async () => {
    await assert.rejects(
      () => rulesClient.evaluateCategoryRules({ tenantId: 't-1', role: 'ADMIN', context: {} }),
      (err) => err.statusCode === 503 && err.code === 'RULES_SERVICE_UNAVAILABLE'
    );
    await assert.rejects(
      () => rulesClient.evaluateCategoryRules({ tenantId: 't-1', role: 'ADMIN', context: {} }),
      (err) => err.statusCode === 503 && err.code === 'RULES_SERVICE_UNAVAILABLE'
    );
    // Tercera llamada: el circuito ya está abierto, no invoca fetchImpl
    await assert.rejects(
      () => rulesClient.evaluateCategoryRules({ tenantId: 't-1', role: 'ADMIN', context: {} }),
      (err) => err.statusCode === 503 && /Circuito abierto/.test(err.message)
    );
  });

  assert.deepEqual(recibidosRules, ['corr-distribuido-99', 'corr-distribuido-99']);

  const recibidosDispatch = [];
  const dispatchClient = new DispatchServiceHttpClient({
    baseUrl: 'http://dispatch.internal',
    retries: 0,
    failureThreshold: 2,
    resetTimeoutMs: 60000,
    fetchImpl: async (_url, opts) => {
      recibidosDispatch.push(opts.headers['X-Correlation-ID']);
      return { ok: false, status: 503, json: async () => ({}) };
    },
  });

  await conCorrelationId('corr-distribuido-99', async () => {
    await assert.rejects(
      () => dispatchClient.listMyAssignedRequestIds({ authorization: 'Bearer tok' }),
      (err) => err.statusCode === 503 && err.code === 'DISPATCH_SERVICE_UNAVAILABLE'
    );
    await assert.rejects(
      () => dispatchClient.listMyAssignedRequestIds({ authorization: 'Bearer tok' }),
      (err) => err.statusCode === 503 && err.code === 'DISPATCH_SERVICE_UNAVAILABLE'
    );
    await assert.rejects(
      () => dispatchClient.listMyAssignedRequestIds({ authorization: 'Bearer tok' }),
      (err) => err.statusCode === 503 && /Circuito abierto/.test(err.message)
    );
  });

  assert.deepEqual(recibidosDispatch, ['corr-distribuido-99', 'corr-distribuido-99']);
});
