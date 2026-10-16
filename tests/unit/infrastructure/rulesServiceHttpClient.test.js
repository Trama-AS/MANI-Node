const test = require('node:test');
const assert = require('node:assert/strict');
const RulesServiceHttpClient = require('../../../src/infrastructure/clients/RulesServiceHttpClient');
const RuleEvaluationResult = require('../../../src/domain/entities/RuleEvaluationResult');

const PARAMS = {
  tenantId: 'tenant-1',
  categoryId: null,
  role: 'ADMIN',
  correlationId: 'corr-1',
  context: { operation: 'CREATE', name: 'Plomería', flujoOperativo: 'TARIFA_ESTANDAR' },
};

function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function scriptedFetch(...steps) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const step = steps[Math.min(calls.length - 1, steps.length - 1)];
    if (step instanceof Error) throw step;
    return step;
  };
  return { fetchImpl, calls };
}

const ALLOWED = {
  allowed: true,
  ruleSetVersion: 'category-rules-v1',
  violations: [],
  normalized: { name: 'Plomería', flujoOperativo: 'TARIFA_ESTANDAR' },
};

test('envía el contrato a /api/v1/rules/categories/evaluate con tenant, rol y correlación en encabezados', async () => {
  const { fetchImpl, calls } = scriptedFetch(jsonResponse(200, ALLOWED));
  const client = new RulesServiceHttpClient({ baseUrl: 'http://rules-service:8080/', fetchImpl });

  const result = await client.evaluateCategoryRules(PARAMS);

  assert.ok(result instanceof RuleEvaluationResult);
  assert.equal(result.allowed, true);
  assert.equal(result.ruleSetVersion, 'category-rules-v1');
  assert.deepEqual(result.normalized, ALLOWED.normalized);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://rules-service:8080/api/v1/rules/categories/evaluate');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['X-Tenant-Id'], 'tenant-1');
  assert.equal(calls[0].init.headers['X-User-Role'], 'ADMIN');
  assert.equal(calls[0].init.headers['X-Correlation-ID'], 'corr-1');
  assert.deepEqual(JSON.parse(calls[0].init.body), { categoryId: null, context: PARAMS.context });
  assert.ok(calls[0].init.signal, 'debe aplicar timeout');
});

test('el tenant nunca viaja en el cuerpo, solo como X-Tenant-Id', async () => {
  const { fetchImpl, calls } = scriptedFetch(jsonResponse(200, ALLOWED));
  await new RulesServiceHttpClient({ baseUrl: 'http://r', fetchImpl }).evaluateCategoryRules(PARAMS);

  assert.equal(JSON.parse(calls[0].init.body).tenantId, undefined);
});

test('allowed=false se devuelve como resultado (no como error) con sus violaciones', async () => {
  const denied = {
    allowed: false,
    ruleSetVersion: 'category-rules-v1',
    violations: [{ code: 'MANI-CAT-422N', field: 'name', message: 'x' }],
  };
  const { fetchImpl } = scriptedFetch(jsonResponse(200, denied));

  const result = await new RulesServiceHttpClient({ baseUrl: 'http://r', fetchImpl }).evaluateCategoryRules(PARAMS);

  assert.equal(result.allowed, false);
  assert.equal(result.violations[0].code, 'MANI-CAT-422N');
});

test('reintenta una vez ante error de red y responde con el segundo intento', async () => {
  const { fetchImpl, calls } = scriptedFetch(new Error('ECONNREFUSED'), jsonResponse(200, ALLOWED));

  const result = await new RulesServiceHttpClient({ baseUrl: 'http://r', fetchImpl }).evaluateCategoryRules(PARAMS);

  assert.equal(result.allowed, true);
  assert.equal(calls.length, 2);
});

test('reintenta ante 503 y, si persiste, responde 503 RULES_SERVICE_UNAVAILABLE', async () => {
  const { fetchImpl, calls } = scriptedFetch(jsonResponse(503, {}), jsonResponse(503, {}));

  await assert.rejects(
    () => new RulesServiceHttpClient({ baseUrl: 'http://r', fetchImpl }).evaluateCategoryRules(PARAMS),
    (err) => {
      assert.equal(err.statusCode, 503);
      assert.equal(err.code, 'RULES_SERVICE_UNAVAILABLE');
      return true;
    }
  );
  assert.equal(calls.length, 2);
});

test('un 500 de Rules no se reintenta y se traduce a 503', async () => {
  const { fetchImpl, calls } = scriptedFetch(jsonResponse(500, {}));

  await assert.rejects(
    () => new RulesServiceHttpClient({ baseUrl: 'http://r', fetchImpl }).evaluateCategoryRules(PARAMS),
    (err) => err.statusCode === 503 && err.code === 'RULES_SERVICE_UNAVAILABLE'
  );
  assert.equal(calls.length, 1);
});

test('un timeout se trata como no disponible (503) tras reintentar', async () => {
  const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
  const { fetchImpl, calls } = scriptedFetch(timeout, timeout);

  await assert.rejects(
    () =>
      new RulesServiceHttpClient({ baseUrl: 'http://r', timeoutMs: 50, fetchImpl }).evaluateCategoryRules(PARAMS),
    (err) => {
      assert.equal(err.statusCode, 503);
      assert.match(err.message, /sin respuesta en 50 ms/);
      return true;
    }
  );
  assert.equal(calls.length, 2);
});

test('un 4xx de Rules es una falla de integración (502 RULES_SERVICE_ERROR) y no se reintenta', async () => {
  const { fetchImpl, calls } = scriptedFetch(
    jsonResponse(403, { error: 'Solo el administrador', code: 'FORBIDDEN' })
  );

  await assert.rejects(
    () => new RulesServiceHttpClient({ baseUrl: 'http://r', fetchImpl }).evaluateCategoryRules(PARAMS),
    (err) => {
      assert.equal(err.statusCode, 502);
      assert.equal(err.code, 'RULES_SERVICE_ERROR');
      assert.match(err.message, /FORBIDDEN/);
      return true;
    }
  );
  assert.equal(calls.length, 1);
});

test('una respuesta 200 fuera de contrato responde 502 en vez de un 400 al usuario', async () => {
  const { fetchImpl } = scriptedFetch(jsonResponse(200, { ruleSetVersion: 'v1' }));

  await assert.rejects(
    () => new RulesServiceHttpClient({ baseUrl: 'http://r', fetchImpl }).evaluateCategoryRules(PARAMS),
    (err) => err.statusCode === 502 && err.code === 'RULES_SERVICE_ERROR'
  );
});

test('sin RULES_SERVICE_URL configurada responde 503 sin intentar la llamada', async () => {
  const { fetchImpl, calls } = scriptedFetch(jsonResponse(200, ALLOWED));

  await assert.rejects(
    () => new RulesServiceHttpClient({ baseUrl: undefined, fetchImpl }).evaluateCategoryRules(PARAMS),
    (err) => err.statusCode === 503 && /RULES_SERVICE_URL/.test(err.message)
  );
  assert.equal(calls.length, 0);
});
