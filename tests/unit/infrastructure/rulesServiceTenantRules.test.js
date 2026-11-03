// SCRUM-1366: cliente de POST /api/v1/rules/tenant-rules/validate. Unas reglas que Rules declara inválidas son 422;
// si Rules no responde, 503 y nada se guarda (T2).
const test = require('node:test');
const assert = require('node:assert/strict');
const RulesServiceHttpClient = require('../../../src/infrastructure/clients/RulesServiceHttpClient');

const PARAMS = { tenantId: 'tenant-1', role: 'ADMIN', correlationId: 'corr-1366', rules: { ordenListado: { criterio: 'COBERTURA' } } };
const respuesta = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function cliente(...pasos) {
  const llamadas = [];
  const fetchImpl = async (url, init) => {
    llamadas.push({ url, init });
    const paso = pasos[Math.min(llamadas.length - 1, pasos.length - 1)];
    if (paso instanceof Error) throw paso;
    return paso;
  };
  return { client: new RulesServiceHttpClient({ baseUrl: 'http://rules-service:8080', fetchImpl, retries: 1 }), llamadas };
}

test('envía las reglas con tenant, rol y correlación y devuelve la respuesta de Rules si son válidas', async () => {
  const { client, llamadas } = cliente(respuesta(200, { valid: true, version: 'tenant-rules-v1', violations: [] }));
  const r = await client.validateTenantRules(PARAMS);

  assert.equal(r.valid, true);
  assert.equal(llamadas[0].url, 'http://rules-service:8080/api/v1/rules/tenant-rules/validate');
  assert.equal(llamadas[0].init.headers['X-Tenant-Id'], 'tenant-1');
  assert.equal(llamadas[0].init.headers['X-User-Role'], 'ADMIN');
  assert.equal(llamadas[0].init.headers['X-Correlation-ID'], 'corr-1366');
  assert.deepEqual(JSON.parse(llamadas[0].init.body), { rules: PARAMS.rules });
});

test('reglas inválidas para Rules son 422 RULES_VALIDATION_ERROR con sus violaciones', async () => {
  const { client } = cliente(respuesta(200, { valid: false, violations: ['comision.porcentaje debe ser un número entre 0 y 30'] }));
  await assert.rejects(
    () => client.validateTenantRules(PARAMS),
    (err) => err.statusCode === 422 && err.code === 'RULES_VALIDATION_ERROR' && /comision\.porcentaje/.test(err.message)
  );
});

test('una respuesta sin valid se trata como inválida, nunca como aprobada', async () => {
  const { client } = cliente(respuesta(200, {}));
  await assert.rejects(() => client.validateTenantRules(PARAMS), (err) => err.statusCode === 422);
});

test('sin URL o con Rules caído responde 503 RULES_SERVICE_UNAVAILABLE', async () => {
  await assert.rejects(() => new RulesServiceHttpClient({ baseUrl: '' }).validateTenantRules(PARAMS), (err) => err.statusCode === 503);
  const { client, llamadas } = cliente(new Error('ECONNREFUSED'));
  await assert.rejects(() => client.validateTenantRules(PARAMS), (err) => err.statusCode === 503 && err.code === 'RULES_SERVICE_UNAVAILABLE');
  assert.equal(llamadas.length, 2, 'reintenta una vez: validar es idempotente');
});
