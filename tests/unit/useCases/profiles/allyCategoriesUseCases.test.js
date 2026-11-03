const test = require('node:test');
const assert = require('node:assert/strict');
const GetAllyCategoriesUseCase = require('../../../../src/application/useCases/profiles/GetAllyCategoriesUseCase');
const DeclareAllyCategoriesUseCase = require('../../../../src/application/useCases/profiles/DeclareAllyCategoriesUseCase');
const Category = require('../../../../src/domain/entities/Category');

// Las categorías son UUID en `categoria_servicio.id`: las pruebas usan UUID
// reales para que los dobles no sean más permisivos que PostgreSQL (SCRUM-1392).
const CAT_1 = '11111111-1111-4111-8111-111111111111';
const CAT_2 = '22222222-2222-4222-8222-222222222222';
const CAT_INACTIVA = '33333333-3333-4333-8333-333333333333';
const CAT_INEXISTENTE = '44444444-4444-4444-8444-444444444444';

// El doble representa a un aliado con la verificación aprobada, que es el caso
// normal de la historia; los de pendiente y rechazado se construyen aparte.
function makeFakeAliadoRepo(aliado = { id: 'a1', usuarioId: 'u1', tenantId: 't1', estadoVerificacion: 'VERIFIED' }) {
  return {
    findByUsuarioId: async (tenantId, userId) => {
      if (aliado && aliado.tenantId === tenantId && aliado.usuarioId === userId) {
        return aliado;
      }
      return null;
    },
  };
}

function makeFakeAliadoCategoriaRepo(initialCategories = [CAT_1]) {
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
    aliadoCategoriaRepository: makeFakeAliadoCategoriaRepo([CAT_1, CAT_2]),
  });

  const result = await useCase.execute({ userId: 'u1', tenantId: 't1', role: 'ALLY' });

  assert.deepEqual(result, [CAT_1, CAT_2]);
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
    () => useCase.execute({ userId: null, tenantId: 't1', role: 'ALLY', categoryIds: [CAT_1] }),
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
    () => useCase.execute({ userId: 'u1', tenantId: 't1', role: 'CLIENT', categoryIds: [CAT_1] }),
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
      new Category({ id: CAT_1, name: 'Cat 1', active: true, flujoOperativo: 'COTIZACION_PREVIA' }),
    ]),
  });

  await assert.rejects(
    () => useCase.execute({ userId: 'u1', tenantId: 't1', role: 'ALLY', categoryIds: [CAT_1, CAT_INEXISTENTE] }),
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
      new Category({ id: CAT_1, name: 'Cat 1', active: true, flujoOperativo: 'COTIZACION_PREVIA' }),
      new Category({ id: CAT_INACTIVA, name: 'Inactiva', active: false, flujoOperativo: 'COTIZACION_PREVIA' }),
    ]),
  });

  await assert.rejects(
    () => useCase.execute({ userId: 'u1', tenantId: 't1', role: 'ALLY', categoryIds: [CAT_INACTIVA] }),
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
    aliadoCategoriaRepository: makeFakeAliadoCategoriaRepo([CAT_1]),
    catalogRepository: makeFakeCatalogRepo([
      new Category({ id: CAT_1, name: 'Cat 1', active: true, flujoOperativo: 'COTIZACION_PREVIA' }),
      new Category({ id: CAT_2, name: 'Cat 2', active: true, flujoOperativo: 'TARIFA_ESTANDAR' }),
    ]),
  });

  const result = await useCase.execute({
    userId: 'u1',
    tenantId: 't1',
    role: 'ALLY',
    categoryIds: [CAT_1, CAT_2, CAT_1],
  });

  assert.deepEqual(result, [CAT_1, CAT_2]);
});

// --- SCRUM-1392 (HU-M04-03) C1/C2/C3 ---

test('DeclareAllyCategoriesUseCase: un aliado pendiente o rechazado no declara categorías (C2)', async () => {
  const catalogRepository = makeFakeCatalogRepo([
    new Category({ id: CAT_1, name: 'Cat 1', active: true, flujoOperativo: 'COTIZACION_PREVIA' }),
  ]);

  // Se prueban las dos grafías porque `estado_verificacion` llega en español
  // desde PostgreSQL y en inglés desde los repositorios en memoria.
  const noAprobados = [
    { estadoVerificacion: 'PENDING' },
    { estadoVerificacion: 'REJECTED' },
    { estado_verificacion: 'PENDIENTE' },
    { estado_verificacion: 'RECHAZADO' },
    {}, // sin estado: fallo cerrado (T9), no se asume aprobado
  ];

  for (const estado of noAprobados) {
    const consultas = [];
    const useCase = new DeclareAllyCategoriesUseCase({
      aliadoRepository: makeFakeAliadoRepo({ id: 'a1', usuarioId: 'u1', tenantId: 't1', ...estado }),
      aliadoCategoriaRepository: {
        findByAliadoId: async () => [],
        setAliadoCategorias: async () => {
          throw new Error('no debería guardar la declaración de un aliado sin aprobar');
        },
      },
      catalogRepository: {
        findById: async (...args) => {
          consultas.push(args);
          return catalogRepository.findById(...args);
        },
      },
    });

    await assert.rejects(
      () => useCase.execute({ userId: 'u1', tenantId: 't1', role: 'ALLY', categoryIds: [CAT_1] }),
      (err) => {
        assert.equal(err.code, 'MANI-CAT-403');
        assert.equal(err.statusCode, 403);
        return true;
      }
    );

    // No se consulta el catálogo: a quien no está aprobado no se le revela qué
    // categorías existen.
    assert.deepEqual(consultas, []);
  }
});

test('DeclareAllyCategoriesUseCase: un aliado aprobado en español (VERIFICADO) sí declara (C1)', async () => {
  const useCase = new DeclareAllyCategoriesUseCase({
    aliadoRepository: makeFakeAliadoRepo({ id: 'a1', usuarioId: 'u1', tenantId: 't1', estado_verificacion: 'VERIFICADO' }),
    aliadoCategoriaRepository: makeFakeAliadoCategoriaRepo([]),
    catalogRepository: makeFakeCatalogRepo([
      new Category({ id: CAT_1, name: 'Cat 1', active: true, flujoOperativo: 'COTIZACION_PREVIA' }),
    ]),
  });

  assert.deepEqual(await useCase.execute({ userId: 'u1', tenantId: 't1', role: 'ALLY', categoryIds: [CAT_1] }), [CAT_1]);
});

test('DeclareAllyCategoriesUseCase: la declaración reemplaza la selección y se recupera igual al recargar (C1)', async () => {
  const aliadoCategoriaRepository = makeFakeAliadoCategoriaRepo([CAT_1]);
  const dependencias = {
    aliadoRepository: makeFakeAliadoRepo(),
    aliadoCategoriaRepository,
    catalogRepository: makeFakeCatalogRepo([
      new Category({ id: CAT_1, name: 'Cat 1', active: true, flujoOperativo: 'COTIZACION_PREVIA' }),
      new Category({ id: CAT_2, name: 'Cat 2', active: true, flujoOperativo: 'TARIFA_ESTANDAR' }),
    ]),
  };
  const declarar = new DeclareAllyCategoriesUseCase(dependencias);
  const consultar = new GetAllyCategoriesUseCase(dependencias);

  // Quitar una categoría es declarar la selección sin ella: el estado que llega
  // es el final, no un incremento.
  await declarar.execute({ userId: 'u1', tenantId: 't1', role: 'ALLY', categoryIds: [CAT_2] });

  assert.deepEqual(await consultar.execute({ userId: 'u1', tenantId: 't1', role: 'ALLY' }), [CAT_2]);
});

test('DeclareAllyCategoriesUseCase: ningún aliado declara ni consulta categorías de otro tenant (C3)', async () => {
  const guardados = [];
  const dependencias = {
    aliadoRepository: makeFakeAliadoRepo(),
    aliadoCategoriaRepository: {
      findByAliadoId: async () => [],
      setAliadoCategorias: async (...args) => {
        guardados.push(args);
        return [CAT_1];
      },
    },
    catalogRepository: makeFakeCatalogRepo([
      new Category({ id: CAT_1, name: 'Cat 1', active: true, flujoOperativo: 'COTIZACION_PREVIA' }),
    ]),
  };
  const declarar = new DeclareAllyCategoriesUseCase(dependencias);
  const consultar = new GetAllyCategoriesUseCase(dependencias);

  // El aliado existe, pero en el tenant t1: con el claim de otro tenant no se
  // le encuentra y la operación se cierra con 403, sin tocar nada.
  for (const caso of [
    () => declarar.execute({ userId: 'u1', tenantId: 'otro-tenant', role: 'ALLY', categoryIds: [CAT_1] }),
    () => consultar.execute({ userId: 'u1', tenantId: 'otro-tenant', role: 'ALLY' }),
  ]) {
    await assert.rejects(caso, (err) => {
      assert.equal(err.code, 'MANI-CAT-403');
      assert.equal(err.statusCode, 403);
      return true;
    });
  }
  assert.deepEqual(guardados, []);

  // Con su propio tenant sí guarda, y guarda ese tenant, no otro.
  await declarar.execute({ userId: 'u1', tenantId: 't1', role: 'ALLY', categoryIds: [CAT_1] });
  assert.equal(guardados.length, 1);
  assert.equal(guardados[0][0], 't1');
});

test('DeclareAllyCategoriesUseCase: un id que no es UUID responde 422C y no consulta la base (T9)', async () => {
  const useCase = new DeclareAllyCategoriesUseCase({
    aliadoRepository: makeFakeAliadoRepo(),
    aliadoCategoriaRepository: makeFakeAliadoCategoriaRepo([]),
    catalogRepository: {
      findById: async () => {
        throw new Error('no debería consultarse con un id inválido');
      },
    },
  });

  for (const categoryId of ['abc', 'cat-1', '11111111-1111-4111-8111', "' OR 1=1 --"]) {
    await assert.rejects(
      () => useCase.execute({ userId: 'u1', tenantId: 't1', role: 'ALLY', categoryIds: [categoryId] }),
      (err) => {
        assert.equal(err.code, 'MANI-CAT-422C');
        assert.equal(err.statusCode, 422);
        // No se filtra el motor de base de datos (la fuga que QA encontró en SCRUM-1391).
        assert.ok(!/invalid input syntax|uuid_in|22P02/i.test(err.message), `filtra el motor: ${err.message}`);
        return true;
      }
    );
  }
});
