const test = require('node:test');
const assert = require('node:assert/strict');
const GetRequestFormOptionsUseCase = require('../../../../src/application/useCases/requests/GetRequestFormOptionsUseCase');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const cliente = { tenantId: TENANT, userId: USER, role: 'CLIENT' };

function fakeRepo() {
  const calls = [];
  return {
    calls,
    listarCategorias: async (ctx) => {
      calls.push(['categorias', ctx]);
      return [{ id: 'c1', nombre: 'Plomería', flujoOperativo: 'COTIZACION_PREVIA' }];
    },
    listarSitios: async (ctx) => {
      calls.push(['sitios', ctx]);
      return [];
    },
  };
}

test('el cliente lee categorías y sitios con el contexto del token', async () => {
  const repo = fakeRepo();
  const uc = new GetRequestFormOptionsUseCase({ requestFormRepository: repo });

  assert.equal((await uc.categorias({ user: { ...cliente, extra: 'x' } })).length, 1);
  await uc.sitios({ user: cliente });

  assert.deepEqual(repo.calls, [['categorias', cliente], ['sitios', cliente]]);
});

test('aliado y admin reciben 403 MANI-SOL-403C sin consultar', async () => {
  for (const role of ['ALLY', 'ADMIN']) {
    const repo = fakeRepo();
    const uc = new GetRequestFormOptionsUseCase({ requestFormRepository: repo });
    await assert.rejects(uc.categorias({ user: { ...cliente, role } }), { statusCode: 403, code: 'MANI-SOL-403C' });
    await assert.rejects(uc.sitios({ user: { ...cliente, role } }), { statusCode: 403, code: 'MANI-SOL-403C' });
    assert.equal(repo.calls.length, 0);
  }
});

test('sin sesión o con usuario que no es UUID → 401 MANI-SOL-401', async () => {
  const uc = new GetRequestFormOptionsUseCase({ requestFormRepository: fakeRepo() });
  for (const user of [null, { tenantId: TENANT, role: 'CLIENT' }, { ...cliente, userId: 'user-1' }]) {
    await assert.rejects(uc.sitios({ user }), { statusCode: 401, code: 'MANI-SOL-401' });
  }
});

test('exige el repositorio', () => {
  assert.throws(() => new GetRequestFormOptionsUseCase({}), /requestFormRepository es requerido/);
});
