const test = require('node:test');
const assert = require('node:assert/strict');
const GetAllyCoverageUseCase = require('../../../../src/application/useCases/profiles/GetAllyCoverageUseCase');
const DeclareAllyCoverageUseCase = require('../../../../src/application/useCases/profiles/DeclareAllyCoverageUseCase');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const Z1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const Z2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ally = { userId: USER, tenantId: TENANT, role: 'ALLY' };

function fakeRepo() {
  const calls = [];
  return {
    calls,
    obtener: async (ctx) => {
      calls.push(['obtener', ctx]);
      return [{ id: Z1, name: 'Z', level: 'LOCALIDAD', parentId: null, active: true }];
    },
    declarar: async (ctx, ids) => {
      calls.push(['declarar', ctx, ids]);
      return ids.map((id) => ({ id, name: 'Z', level: 'BARRIO', parentId: null, active: true }));
    },
  };
}

test('los casos de uso exigen el repositorio', () => {
  assert.throws(() => new GetAllyCoverageUseCase({}), /coberturaRepository es requerido/);
  assert.throws(() => new DeclareAllyCoverageUseCase({}), /coberturaRepository es requerido/);
});

test('GET: el contexto sale de la sesión y devuelve zonas e ids', async () => {
  const repo = fakeRepo();
  const r = await new GetAllyCoverageUseCase({ coberturaRepository: repo }).execute({ user: ally });
  assert.deepEqual(r.zoneIds, [Z1]);
  assert.deepEqual(repo.calls[0][1], { tenantId: TENANT, userId: USER, role: 'ALLY' });
});

test('sin sesión → 401; con un rol que no es aliado → 403 sin consultar la base', async () => {
  const repo = fakeRepo();
  for (const UseCase of [GetAllyCoverageUseCase, DeclareAllyCoverageUseCase]) {
    const uc = new UseCase({ coberturaRepository: repo });
    await assert.rejects(uc.execute({ user: null, zoneIds: [Z1] }), (e) => e.code === 'MANI-COB-401' && e.statusCode === 401);
    for (const role of ['CLIENT', 'ADMIN', undefined]) {
      await assert.rejects(uc.execute({ user: { ...ally, role }, zoneIds: [Z1] }), (e) => e.code === 'MANI-COB-403' && e.statusCode === 403);
    }
  }
  assert.equal(repo.calls.length, 0);
});

test('PUT: deduplica, ignora vacíos y no acepta tenant ni usuario del cuerpo', async () => {
  const repo = fakeRepo();
  const uc = new DeclareAllyCoverageUseCase({ coberturaRepository: repo });
  const r = await uc.execute({ user: ally, zoneIds: [Z1, ` ${Z2} `, Z1, '', null, 7] });
  assert.deepEqual(r.zoneIds, [Z1, Z2]);
  assert.deepEqual(repo.calls[0], ['declarar', { tenantId: TENANT, userId: USER, role: 'ALLY' }, [Z1, Z2]]);
});

test('PUT: vacío o sin lista → 422V; más de 200 → 422L; no UUID → 422Z; 200 exactas pasan', async () => {
  const repo = fakeRepo();
  const uc = new DeclareAllyCoverageUseCase({ coberturaRepository: repo });
  for (const zoneIds of [[], [''], undefined, null, 'x', {}]) {
    await assert.rejects(uc.execute({ user: ally, zoneIds }), (e) => e.code === 'MANI-COB-422V' && e.statusCode === 422);
  }
  const uuidN = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
  const doscientas = Array.from({ length: 200 }, (_, i) => uuidN(i));
  await assert.rejects(uc.execute({ user: ally, zoneIds: [...doscientas, uuidN(999)] }), (e) => e.code === 'MANI-COB-422L');
  await assert.rejects(uc.execute({ user: ally, zoneIds: ['no-uuid'] }), (e) => e.code === 'MANI-COB-422Z');
  assert.equal(repo.calls.length, 0);
  assert.equal((await uc.execute({ user: ally, zoneIds: doscientas })).zoneIds.length, 200);
});
