const test = require('node:test');
const assert = require('node:assert/strict');
const ListAvailableAllyCategoriesUseCase = require('../../../../src/application/useCases/profiles/ListAvailableAllyCategoriesUseCase');
const Category = require('../../../../src/domain/entities/Category');

function makeAliadoRepo(aliado = { id: 'a1', usuarioId: 'u1', tenantId: 't1' }) {
  return {
    findByUsuarioId: async (tenantId, userId) =>
      aliado && aliado.tenantId === tenantId && aliado.usuarioId === userId ? aliado : null,
  };
}

function makeCatalogRepo() {
  const calls = [];
  return {
    calls,
    findActiveByTenant: async (tenantId) => {
      calls.push(tenantId);
      return [new Category({ id: 'c1', name: 'Electricidad' }), new Category({ id: 'c2', name: 'Plomería' })];
    },
  };
}

const session = { userId: 'u1', tenantId: 't1', role: 'ALLY' };

test('ListAvailableAllyCategoriesUseCase: valida dependencias en constructor', () => {
  assert.throws(() => new ListAvailableAllyCategoriesUseCase({ catalogRepository: {} }), /aliadoRepository/);
  assert.throws(() => new ListAvailableAllyCategoriesUseCase({ aliadoRepository: {} }), /catalogRepository/);
});

test('ListAvailableAllyCategoriesUseCase: sin sesión responde MANI-CAT-401', async () => {
  const uc = new ListAvailableAllyCategoriesUseCase({ aliadoRepository: makeAliadoRepo(), catalogRepository: makeCatalogRepo() });

  await assert.rejects(() => uc.execute({ role: 'ALLY' }), (e) => e.code === 'MANI-CAT-401' && e.statusCode === 401);
  await assert.rejects(() => uc.execute({ userId: 'u1', role: 'ALLY' }), (e) => e.code === 'MANI-CAT-401');
});

test('ListAvailableAllyCategoriesUseCase: un rol distinto de ALLY responde MANI-CAT-403 sin consultar el catálogo', async () => {
  const catalog = makeCatalogRepo();
  const uc = new ListAvailableAllyCategoriesUseCase({ aliadoRepository: makeAliadoRepo(), catalogRepository: catalog });

  await assert.rejects(() => uc.execute({ ...session, role: 'CLIENT' }), (e) => e.code === 'MANI-CAT-403' && e.statusCode === 403);
  assert.deepEqual(catalog.calls, []);
});

test('ListAvailableAllyCategoriesUseCase: sin fila de aliado en ese tenant responde MANI-CAT-403', async () => {
  const catalog = makeCatalogRepo();
  const uc = new ListAvailableAllyCategoriesUseCase({ aliadoRepository: makeAliadoRepo(null), catalogRepository: catalog });

  await assert.rejects(() => uc.execute(session), (e) => e.code === 'MANI-CAT-403');
  assert.deepEqual(catalog.calls, []);
});

test('ListAvailableAllyCategoriesUseCase: consulta el catálogo con el tenant de la sesión y devuelve solo id y nombre', async () => {
  const catalog = makeCatalogRepo();
  const uc = new ListAvailableAllyCategoriesUseCase({ aliadoRepository: makeAliadoRepo(), catalogRepository: catalog });

  const result = await uc.execute(session);

  assert.deepEqual(catalog.calls, ['t1']);
  assert.deepEqual(result, [
    { id: 'c1', name: 'Electricidad' },
    { id: 'c2', name: 'Plomería' },
  ]);
});
