// SCRUM-887 / SCRUM-1462: cliente de POST /api/v1/rules/rates/evaluate. Core envía los hechos y Rules decide; si Rules
// no responde o responde fuera de contrato, Core no compara importes por su cuenta (T2).
const test = require('node:test');
const assert = require('node:assert/strict');
const RulesServiceHttpClient = require('../../../src/infrastructure/clients/RulesServiceHttpClient');

const item = (id, total = 150) => ({ id, total, valorMin: 100, valorTipico: 150, valorMax: 200 });
const PARAMS = { tenantId: 'tenant-1', role: 'ADMIN', correlationId: 'corr-887', items: [item('a', 90), item('b')] };

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function scriptedFetch(...steps) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const step = typeof steps[0] === 'function' ? steps[0](url, init) : steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return step;
  };
  return { fetchImpl, calls };
}

const respuesta = (items) => ({
  version: 'rates-v1',
  resultados: items.map((i) => ({ id: i.id, resultado: i.total < 100 ? 'POR_DEBAJO' : 'DENTRO_DE_RANGO', desviacionPorcentaje: i.total < 100 ? 10 : 0 })),
});

test('envía los importes a /api/v1/rules/rates/evaluate con tenant, rol y correlación y devuelve cada resultado', async () => {
  const { fetchImpl, calls } = scriptedFetch(jsonResponse(200, respuesta(PARAMS.items)));
  const client = new RulesServiceHttpClient({ baseUrl: 'http://rules-service:8080', fetchImpl });

  const r = await client.evaluateRates(PARAMS);

  assert.equal(calls[0].url, 'http://rules-service:8080/api/v1/rules/rates/evaluate');
  assert.equal(calls[0].init.headers['X-Tenant-Id'], 'tenant-1');
  assert.equal(calls[0].init.headers['X-User-Role'], 'ADMIN');
  assert.equal(calls[0].init.headers['X-Correlation-ID'], 'corr-887');
  assert.deepEqual(JSON.parse(calls[0].init.body), { items: PARAMS.items });
  assert.deepEqual(r, {
    version: 'rates-v1',
    resultados: [
      { id: 'a', resultado: 'POR_DEBAJO', desviacionPorcentaje: 10 },
      { id: 'b', resultado: 'DENTRO_DE_RANGO', desviacionPorcentaje: 0 },
    ],
  });
});

test('parte la lista en lotes de 500, que es el máximo que acepta Rules', async () => {
  const items = Array.from({ length: 1201 }, (_, i) => item(`c${i}`));
  const { fetchImpl, calls } = scriptedFetch((_url, init) => jsonResponse(200, respuesta(JSON.parse(init.body).items)));
  const r = await new RulesServiceHttpClient({ baseUrl: 'http://rules', fetchImpl }).evaluateRates({ ...PARAMS, items });

  assert.deepEqual(calls.map((c) => JSON.parse(c.init.body).items.length), [500, 500, 201]);
  assert.equal(r.resultados.length, 1201);
});

test('una respuesta incompleta, con ids ajenos o con resultados desconocidos es 502: Core no adivina', async () => {
  const malas = [
    { version: 'v', resultados: [{ id: 'a', resultado: 'POR_DEBAJO', desviacionPorcentaje: 1 }] },
    { version: 'v', resultados: [{ id: 'a', resultado: 'POR_DEBAJO', desviacionPorcentaje: 1 }, { id: 'zz', resultado: 'DENTRO_DE_RANGO', desviacionPorcentaje: 0 }] },
    { version: 'v', resultados: [{ id: 'a', resultado: 'CARO', desviacionPorcentaje: 1 }, { id: 'b', resultado: 'DENTRO_DE_RANGO', desviacionPorcentaje: 0 }] },
    { version: 'v', resultados: [{ id: 'a', resultado: 'POR_DEBAJO' }, { id: 'b', resultado: 'DENTRO_DE_RANGO', desviacionPorcentaje: 0 }] },
    null,
  ];
  for (const cuerpo of malas) {
    const { fetchImpl } = scriptedFetch(jsonResponse(200, cuerpo));
    await assert.rejects(
      () => new RulesServiceHttpClient({ baseUrl: 'http://rules', fetchImpl }).evaluateRates(PARAMS),
      (err) => err.statusCode === 502 && err.code === 'RULES_SERVICE_ERROR',
      JSON.stringify(cuerpo)
    );
  }
});

test('sin URL, caído o con 503 persistente responde 503; un 400 de Rules es falla de integración (502)', async () => {
  await assert.rejects(() => new RulesServiceHttpClient({ baseUrl: '' }).evaluateRates(PARAMS), (err) => err.statusCode === 503);

  const caido = scriptedFetch(new Error('ECONNREFUSED'));
  await assert.rejects(() => new RulesServiceHttpClient({ baseUrl: 'http://rules', fetchImpl: caido.fetchImpl }).evaluateRates(PARAMS), (err) => err.statusCode === 503 && err.code === 'RULES_SERVICE_UNAVAILABLE');
  assert.equal(caido.calls.length, 2, 'reintenta una vez: la evaluación es idempotente');

  const no = scriptedFetch(jsonResponse(503, {}));
  await assert.rejects(() => new RulesServiceHttpClient({ baseUrl: 'http://rules', fetchImpl: no.fetchImpl }).evaluateRates(PARAMS), (err) => err.statusCode === 503);

  const contrato = scriptedFetch(jsonResponse(400, { code: 'VALIDATION_ERROR', error: 'items: debe traer al menos un importe' }));
  await assert.rejects(() => new RulesServiceHttpClient({ baseUrl: 'http://rules', fetchImpl: contrato.fetchImpl }).evaluateRates(PARAMS), (err) => err.statusCode === 502 && /VALIDATION_ERROR/.test(err.message));
});

test('una lista vacía no llama a Rules', async () => {
  const { fetchImpl, calls } = scriptedFetch(jsonResponse(200, {}));
  const r = await new RulesServiceHttpClient({ baseUrl: 'http://rules', fetchImpl }).evaluateRates({ ...PARAMS, items: [] });
  assert.deepEqual(r, { version: null, resultados: [] });
  assert.equal(calls.length, 0);
});
