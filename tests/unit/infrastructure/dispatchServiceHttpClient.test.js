const test = require('node:test');
const assert = require('node:assert/strict');
const DispatchServiceHttpClient = require('../../../src/infrastructure/clients/DispatchServiceHttpClient');

const DISPATCH_URL = 'http://dispatch';
const JWT_ALIADO = 'Bearer x';

function respuesta(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function fetchQueResponde(...respuestas) {
  const llamadas = [];
  const fetchImpl = async (url, init) => {
    llamadas.push({ url, init });
    const siguiente = respuestas.shift();
    if (siguiente instanceof Error) throw siguiente;
    return siguiente;
  };
  return { fetchImpl, llamadas };
}

test('consulta GET /api/v1/dispatch/assignments/me reenviando el JWT del aliado y el correlation id', async () => {
  const { fetchImpl, llamadas } = fetchQueResponde(respuesta(200, { requestIds: ['sol-1', 'sol-2'], total: 2 }));
  const client = new DispatchServiceHttpClient({ baseUrl: 'http://dispatch-service:5000/', fetchImpl });

  const ids = await client.listMyAssignedRequestIds({ authorization: 'Bearer jwt-aliado', correlationId: 'corr-9' });

  assert.deepEqual(ids, ['sol-1', 'sol-2']);
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].url, 'http://dispatch-service:5000/api/v1/dispatch/assignments/me');
  assert.equal(llamadas[0].init.method, 'GET');
  assert.equal(llamadas[0].init.headers.Authorization, 'Bearer jwt-aliado');
  assert.equal(llamadas[0].init.headers['X-Correlation-ID'], 'corr-9');
});

test('sin DISPATCH_SERVICE_URL responde 503 sin llamar a nadie (criterio T2)', async () => {
  const { fetchImpl, llamadas } = fetchQueResponde();
  const client = new DispatchServiceHttpClient({ baseUrl: undefined, fetchImpl });

  await assert.rejects(
    () => client.listMyAssignedRequestIds({ authorization: JWT_ALIADO }),
    (err) => err.statusCode === 503 && err.code === 'DISPATCH_SERVICE_UNAVAILABLE'
  );
  assert.equal(llamadas.length, 0);
});

test('reintenta una vez ante 503 o error de red y devuelve la respuesta del segundo intento', async () => {
  for (const primero of [respuesta(503, {}), new Error('ECONNREFUSED')]) {
    const { fetchImpl, llamadas } = fetchQueResponde(primero, respuesta(200, { requestIds: ['sol-1'] }));
    const client = new DispatchServiceHttpClient({ baseUrl: DISPATCH_URL, fetchImpl });

    assert.deepEqual(await client.listMyAssignedRequestIds({ authorization: JWT_ALIADO }), ['sol-1']);
    assert.equal(llamadas.length, 2);
  }
});

test('si Dispatch sigue sin responder tras el reintento, 503 (criterio T2)', async () => {
  const { fetchImpl, llamadas } = fetchQueResponde(respuesta(504, {}), respuesta(504, {}));
  const client = new DispatchServiceHttpClient({ baseUrl: DISPATCH_URL, fetchImpl });

  await assert.rejects(
    () => client.listMyAssignedRequestIds({ authorization: JWT_ALIADO }),
    (err) => err.statusCode === 503 && err.code === 'DISPATCH_SERVICE_UNAVAILABLE'
  );
  assert.equal(llamadas.length, 2);
});

test('un 500 no se reintenta y responde 503', async () => {
  const { fetchImpl, llamadas } = fetchQueResponde(respuesta(500, {}));
  const client = new DispatchServiceHttpClient({ baseUrl: DISPATCH_URL, fetchImpl });

  await assert.rejects(() => client.listMyAssignedRequestIds({ authorization: JWT_ALIADO }), (err) => err.statusCode === 503);
  assert.equal(llamadas.length, 1);
});

test('403 de Dispatch (la cuenta no es aliado del tenant) equivale a no tener asignaciones', async () => {
  const { fetchImpl } = fetchQueResponde(respuesta(403, { error: 'Rol no autorizado' }));
  const client = new DispatchServiceHttpClient({ baseUrl: DISPATCH_URL, fetchImpl });

  assert.deepEqual(await client.listMyAssignedRequestIds({ authorization: JWT_ALIADO }), []);
});

test('otro 4xx o una respuesta sin requestIds es una falla de integración (502)', async () => {
  for (const r of [respuesta(401, { error: 'token' }), respuesta(200, { total: 0 })]) {
    const { fetchImpl } = fetchQueResponde(r);
    const client = new DispatchServiceHttpClient({ baseUrl: DISPATCH_URL, fetchImpl });

    await assert.rejects(
      () => client.listMyAssignedRequestIds({ authorization: JWT_ALIADO }),
      (err) => err.statusCode === 502 && err.code === 'DISPATCH_SERVICE_ERROR'
    );
  }
});
