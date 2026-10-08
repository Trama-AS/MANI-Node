const test = require('node:test');
const assert = require('node:assert/strict');
const GetAllyCategoriesUseCase = require('../../../../src/application/useCases/profiles/GetAllyCategoriesUseCase');
const DeclareAllyCategoriesUseCase = require('../../../../src/application/useCases/profiles/DeclareAllyCategoriesUseCase');
const Category = require('../../../../src/domain/entities/Category');

function makeFakeAliadoRepo(aliado = { id: 'a1', usuarioId: 'u1', tenantId: 't1' }) {
  return {
    findByUsuarioId: async (tenantId, userId) => {
      if (aliado && aliado.tenantId === tenantId && aliado.usuarioId === userId) {
        return aliado;
      }
      return null;
    },
  };
}

function makeFakeAliadoCategoriaRepo(initialCategories = ['cat-1']) {
  let categories = [...initialCategories];
  return {
    findByAliadoId: async () => [...categories],
    setAliadoCategorias: async (_tenantId, _aliadoId, ids) => {
      categories = [...ids];
      return [...categories];
    },
  };
}

function makeFakeCatalogRepo(categories = []) {
  return {
    findById: async (_tenantId, catId) => {
      return categories.find((c) => c.id === catId) || null;
    },
  };
}

test('GetAllyCategoriesUseCase: valida dependencias en constructor', () => {
  assert.throws(() => new GetAllyCategoriesUseCase({}), /aliadoRepository es requerido/);
  assert.throws(
    () => new GetAllyCategoriesUseCase({ aliadoRepository: {} }),
    /aliadoCategoriaRepository es requerido/
  );
});

test('GetAllyCategoriesUseCase: lanza MANI-CAT-401 si falta sesión', async () => {
  const useCase = new GetAllyCategoriesUseCase({
    aliadoRepository: makeFakeAliadoRepo(),
    aliadoCategoriaRepository: makeFakeAliadoCategoriaRepo(),
  });

  await assert.rejects(
    () => useCase.execute({ userId: null, tenantId: 't1', role: 'ALLY' }),
    (err) => {
      assert.equal(err.code, 'MANI-CAT-401');
      assert.equal(err.statusCode, 401);
      return true;
    }
  );
});

test('GetAllyCategoriesUseCase: lanza MANI-CAT-403 si el rol no es ALLY', async () => {
  const useCase = new GetAllyCategoriesUseCase({
    aliadoRepository: makeFakeAliadoRepo(),
    aliadoCategoriaRepo: makeFakeAliadoCategoriaRepo(),
    aliadoCategoriaRepository: makeFakeAliadoCategoriaRepo(),
  });

  await assert.rejects(
    () => useCase.execute({ userId: 'u1', tenantId: 't1', role: 'CLIENT' }),
    (err) => {
      assert.equal(err.code, 'MANI-CAT-403');
      assert.equal(err.statusCode, 403);
      return true;
    }
  );
});

test('GetAllyCategoriesUseCase: lanza MANI-CAT-403 si el aliado no existe en la base de datos', async () => {
  const useCase = new GetAllyCategoriesUseCase({
    aliadoRepository: makeFakeAliadoRepo(null),
    aliadoCategoriaRepository: makeFakeAliadoCategoriaRepo(),
  });

  await assert.rejects(
    () => useCase.execute({ userId: 'u1', tenantId: 't1', role: 'ALLY' }),
    (err) => {
      assert.equal(err.code, 'MANI-CAT-403');
      return true;
    }
  );
});

test('GetAllyCategoriesUseCase: retorna las categorías del aliado', async () => {
  const useCase = new GetAllyCategoriesUseCase({
    aliadoRepository: makeFakeAliadoRepo(),
    aliadoCategoriaRepository: makeFakeAliadoCategoriaRepo(['cat-1', 'cat-2']),
  });

  const result = await useCase.execute({ userId: 'u1', tenantId: 't1', role: 'ALLY' });

  assert.deepEqual(result, ['cat-1', 'cat-2']);
});

test('DeclareAllyCategoriesUseCase: valida dependencias en constructor', () => {
  assert.throws(() => new DeclareAllyCategoriesUseCase({}), /aliadoRepository es requerido/);
  assert.throws(
    () => new DeclareAllyCategoriesUseCase({ aliadoRepository: {} }),
    /aliadoCategoriaRepository es requerido/
  );
  assert.throws(
    () => new DeclareAllyCategoriesUseCase({ aliadoRepository: {}, aliadoCategoriaRepository: {} }),
    /catalogRepository es requerido/
  );
});

test('DeclareAllyCategoriesUseCase: lanza MANI-CAT-401 si falta sesión', async () => {
  const useCase = new DeclareAllyCategoriesUseCase({
    aliadoRepository: makeFakeAliadoRepo(),
    aliadoCategoriaRepository: makeFakeAliadoCategoriaRepo(),
    catalogRepository: makeFakeCatalogRepo(),
  });

  await assert.rejects(
    () => useCase.execute({ userId: null, tenantId: 't1', role: 'ALLY', categoryIds: ['cat-1'] }),
    (err) => {
      assert.equal(err.code, 'MANI-CAT-401');
      assert.equal(err.statusCode, 401);
      return true;
    }
  );
});

test('DeclareAllyCategoriesUseCase: lanza MANI-CAT-403 si el rol no es ALLY', async () => {
  const useCase = new DeclareAllyCategoriesUseCase({
    aliadoRepository: makeFakeAliadoRepo(),
    aliadoCategoriaRepository: makeFakeAliadoCategoriaRepo(),
    catalogRepository: makeFakeCatalogRepo(),
  });

  await assert.rejects(
    () => useCase.execute({ userId: 'u1', tenantId: 't1', role: 'CLIENT', categoryIds: ['cat-1'] }),
    (err) => {
      assert.equal(err.code, 'MANI-CAT-403');
      return true;
    }
  );
});

test('DeclareAllyCategoriesUseCase: lanza MANI-CAT-422V si la lista de categorías está vacía', async () => {
  const useCase = new DeclareAllyCategoriesUseCase({
    aliadoRepository: makeFakeAliadoRepo(),
    aliadoCategoriaRepository: makeFakeAliadoCategoriaRepo(),
    catalogRepository: makeFakeCatalogRepo(),
  });

  await assert.rejects(
    () => useCase.execute({ userId: 'u1', tenantId: 't1', role: 'ALLY', categoryIds: [] }),
    (err) => {
      assert.equal(err.code, 'MANI-CAT-422V');
      assert.equal(err.statusCode, 422);
      return true;
    }
  );

  await assert.rejects(
    () => useCase.execute({ userId: 'u1', tenantId: 't1', role: 'ALLY', categoryIds: ['  '] }),
    (err) => {
      assert.equal(err.code, 'MANI-CAT-422V');
      return true;
    }
  );
});

test('DeclareAllyCategoriesUseCase: lanza MANI-CAT-422C si una categoría no existe', async () => {
  const useCase = new DeclareAllyCategoriesUseCase({
    aliadoRepository: makeFakeAliadoRepo(),
    aliadoCategoriaRepository: makeFakeAliadoCategoriaRepo(),
    catalogRepository: makeFakeCatalogRepo([
      new Category({ id: 'cat-1', name: 'Cat 1', active: true, flujoOperativo: 'COTIZACION_PREVIA' }),
    ]),
  });

  await assert.rejects(
    () => useCase.execute({ userId: 'u1', tenantId: 't1', role: 'ALLY', categoryIds: ['cat-1', 'cat-inexistente'] }),
    (err) => {
      assert.equal(err.code, 'MANI-CAT-422C');
      assert.equal(err.statusCode, 422);
      return true;
    }
  );
});

test('DeclareAllyCategoriesUseCase: lanza MANI-CAT-422C si una categoría está inactiva', async () => {
  const useCase = new DeclareAllyCategoriesUseCase({
    aliadoRepository: makeFakeAliadoRepo(),
    aliadoCategoriaRepository: makeFakeAliadoCategoriaRepo(),
    catalogRepository: makeFakeCatalogRepo([
      new Category({ id: 'cat-1', name: 'Cat 1', active: true, flujoOperativo: 'COTIZACION_PREVIA' }),
      new Category({ id: 'cat-inactive', name: 'Inactiva', active: false, flujoOperativo: 'COTIZACION_PREVIA' }),
    ]),
  });

  await assert.rejects(
    () => useCase.execute({ userId: 'u1', tenantId: 't1', role: 'ALLY', categoryIds: ['cat-inactive'] }),
    (err) => {
      assert.equal(err.code, 'MANI-CAT-422C');
      assert.equal(err.statusCode, 422);
      return true;
    }
  );
});

test('DeclareAllyCategoriesUseCase: guarda exitosamente deduplicando IDs y retorna categorías', async () => {
  const useCase = new DeclareAllyCategoriesUseCase({
    aliadoRepository: makeFakeAliadoRepo(),
    aliadoCategoriaRepository: makeFakeAliadoCategoriaRepo(['cat-1']),
    catalogRepository: makeFakeCatalogRepo([
      new Category({ id: 'cat-1', name: 'Cat 1', active: true, flujoOperativo: 'COTIZACION_PREVIA' }),
      new Category({ id: 'cat-2', name: 'Cat 2', active: true, flujoOperativo: 'TARIFA_ESTANDAR' }),
    ]),
  });

  const result = await useCase.execute({
    userId: 'u1',
    tenantId: 't1',
    role: 'ALLY',
    categoryIds: ['cat-1', 'cat-2', 'cat-1'],
  });

  assert.deepEqual(result, ['cat-1', 'cat-2']);
});
