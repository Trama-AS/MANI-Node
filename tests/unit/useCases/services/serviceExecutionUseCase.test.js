const test = require('node:test');
const assert = require('node:assert/strict');
const ServiceExecutionUseCase = require('../../../../src/application/useCases/services/ServiceExecutionUseCase');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';
const aliado = { tenantId: TENANT, userId: USER, role: 'ALLY' };

function fakeRepo() {
  const calls = [];
  return {
    calls,
    marcar: async (ctx, datos) => {
      calls.push(['marcar', ctx, datos]);
      return { solicitud: { id: datos.solicitudId, estado: 'EN_EJECUCION' } };
    },
    consultar: async (ctx, solicitudId) => {
      calls.push(['consultar', ctx, solicitudId]);
      return { solicitudId };
    },
  };
}

const uc = (repo) => new ServiceExecutionUseCase({ serviceExecutionRepository: repo });

test('el aliado marca inicio y fin con el contexto del token y la observación recortada', async () => {
  const repo = fakeRepo();
  await uc(repo).marcar({ user: aliado, solicitudId: SOLICITUD, hito: 'INICIO', body: { observacion: '  Llegué  ', fecha: '2020-01-01' } });
  await uc(repo).marcar({ user: aliado, solicitudId: SOLICITUD, hito: 'FIN' });
  assert.deepEqual(repo.calls, [
    ['marcar', aliado, { solicitudId: SOLICITUD, hito: 'INICIO', observacion: 'Llegué' }],
    ['marcar', aliado, { solicitudId: SOLICITUD, hito: 'FIN', observacion: '' }],
  ]);
});

test('C3: cliente y admin no marcan la ejecución (403 MANI-EJE-403)', async () => {
  for (const role of ['CLIENT', 'ADMIN']) {
    const repo = fakeRepo();
    await assert.rejects(uc(repo).marcar({ user: { ...aliado, role }, solicitudId: SOLICITUD, hito: 'INICIO' }), {
      statusCode: 403,
      code: 'MANI-EJE-403',
    });
    assert.equal(repo.calls.length, 0);
  }
});

test('C2: observación que no es texto o de más de 500 caracteres, o id inválido → 400 sin tocar la base', async () => {
  for (const [solicitudId, body] of [
    [SOLICITUD, { observacion: 42 }],
    [SOLICITUD, { observacion: 'x'.repeat(501) }],
    ['abc', {}],
  ]) {
    const repo = fakeRepo();
    await assert.rejects(uc(repo).marcar({ user: aliado, solicitudId, hito: 'INICIO', body }), {
      statusCode: 400,
      code: 'MANI-EJE-400',
    });
    assert.equal(repo.calls.length, 0);
  }
});

test('cliente y aliado consultan la ejecución; el admin no', async () => {
  for (const role of ['CLIENT', 'ALLY']) {
    const repo = fakeRepo();
    await uc(repo).consultar({ user: { ...aliado, role }, solicitudId: SOLICITUD });
    assert.equal(repo.calls[0][2], SOLICITUD);
  }
  await assert.rejects(uc(fakeRepo()).consultar({ user: { ...aliado, role: 'ADMIN' }, solicitudId: SOLICITUD }), {
    statusCode: 403,
  });
});

test('sin sesión → 401 y exige el repositorio', async () => {
  await assert.rejects(uc(fakeRepo()).marcar({ user: null, solicitudId: SOLICITUD, hito: 'INICIO' }), {
    statusCode: 401,
    code: 'MANI-EJE-401',
  });
  assert.throws(() => new ServiceExecutionUseCase({}), /serviceExecutionRepository es requerido/);
});
