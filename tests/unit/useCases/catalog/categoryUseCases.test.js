const test = require('node:test');
const assert = require('node:assert/strict');
const CreateCategoryUseCase = require('../../../../src/application/useCases/catalog/CreateCategoryUseCase');
const UpdateCategoryUseCase = require('../../../../src/application/useCases/catalog/UpdateCategoryUseCase');
const GetCategoryUseCase = require('../../../../src/application/useCases/catalog/GetCategoryUseCase');
const ListCategoriesForTenantUseCase = require('../../../../src/application/useCases/catalog/ListCategoriesForTenantUseCase');
const SetCategoryStatusUseCase = require('../../../../src/application/useCases/catalog/SetCategoryStatusUseCase');
const InMemoryCatalogRepository = require('../../../../src/infrastructure/repositories/InMemoryCatalogRepository');

// --- CreateCategoryUseCase ---

test('CreateCategoryUseCase crea una categoría activa asociada al tenant, con su flujoOperativo', async () => {
  const catalogRepository = new InMemoryCatalogRepository();
  const useCase = new CreateCategoryUseCase({ catalogRepository });

  const result = await useCase.execute({
    tenantId: 't1',
    name: 'Peinados',
    description: 'Para eventos',
    flujoOperativo: 'TARIFA_ESTANDAR',
  });

  assert.equal(result.tenantId, 't1');
  assert.equal(result.active, true);
  assert.equal(result.description, 'Para eventos');
  assert.equal(result.flujoOperativo, 'TARIFA_ESTANDAR');
});

test('CreateCategoryUseCase rechaza sin tenantId, sin name o sin flujoOperativo', async () => {
  const useCase = new CreateCategoryUseCase({ catalogRepository: new InMemoryCatalogRepository() });

  await assert.rejects(
    () => useCase.execute({ name: 'x', flujoOperativo: 'TARIFA_ESTANDAR' }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
  await assert.rejects(
    () => useCase.execute({ tenantId: 't1', flujoOperativo: 'TARIFA_ESTANDAR' }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
  await assert.rejects(
    () => useCase.execute({ tenantId: 't1', name: 'Peinados' }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
  await assert.rejects(
    () => useCase.execute({ tenantId: 't1', name: 'Peinados', flujoOperativo: 'INVALIDO' }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
});

test('CreateCategoryUseCase lanza ConflictError CATEGORY_NAME_ALREADY_EXISTS si el nombre ya existe en el tenant', async () => {
  const catalogRepository = new InMemoryCatalogRepository();
  const useCase = new CreateCategoryUseCase({ catalogRepository });
  await useCase.execute({ tenantId: 't1', name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });

  await assert.rejects(
    () => useCase.execute({ tenantId: 't1', name: 'Peinados', flujoOperativo: 'COTIZACION_PREVIA' }),
    (err) => {
      assert.equal(err.code, 'CATEGORY_NAME_ALREADY_EXISTS');
      assert.equal(err.statusCode, 409);
      return true;
    }
  );
});

// --- GetCategoryUseCase ---

test('GetCategoryUseCase retorna la categoría si pertenece al tenant', async () => {
  const catalogRepository = new InMemoryCatalogRepository();
  const created = await catalogRepository.create('t1', { name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });
  const useCase = new GetCategoryUseCase({ catalogRepository });

  const result = await useCase.execute({ tenantId: 't1', categoryId: created.id });

  assert.equal(result.id, created.id);
});

test('GetCategoryUseCase lanza NotFoundError/CATEGORY_NOT_FOUND si es de otro tenant', async () => {
  const catalogRepository = new InMemoryCatalogRepository();
  const created = await catalogRepository.create('t1', { name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });
  const useCase = new GetCategoryUseCase({ catalogRepository });

  await assert.rejects(
    () => useCase.execute({ tenantId: 't2', categoryId: created.id }),
    (err) => {
      assert.equal(err.code, 'CATEGORY_NOT_FOUND');
      assert.equal(err.statusCode, 404);
      return true;
    }
  );
});

test('GetCategoryUseCase lanza CATEGORY_NOT_FOUND para una categoría global (no es "del" tenant)', async () => {
  const catalogRepository = new InMemoryCatalogRepository();
  const useCase = new GetCategoryUseCase({ catalogRepository });

  await assert.rejects(
    () => useCase.execute({ tenantId: 't1', categoryId: 'cat-1' }),
    (err) => {
      assert.equal(err.code, 'CATEGORY_NOT_FOUND');
      return true;
    }
  );
});

// --- UpdateCategoryUseCase ---

test('UpdateCategoryUseCase actualiza name/description/flujoOperativo de una categoría del tenant', async () => {
  const catalogRepository = new InMemoryCatalogRepository();
  const created = await catalogRepository.create('t1', {
    name: 'Peinados',
    description: 'Original',
    flujoOperativo: 'TARIFA_ESTANDAR',
  });
  const useCase = new UpdateCategoryUseCase({ catalogRepository });

  const result = await useCase.execute({ tenantId: 't1', categoryId: created.id, name: 'Peinados de Novia' });
  assert.equal(result.name, 'Peinados de Novia');
  assert.equal(result.description, 'Original');

  const resultFlujo = await useCase.execute({
    tenantId: 't1',
    categoryId: created.id,
    flujoOperativo: 'COTIZACION_PREVIA',
  });
  assert.equal(resultFlujo.flujoOperativo, 'COTIZACION_PREVIA');
});

test('UpdateCategoryUseCase lanza CATEGORY_NOT_FOUND si la categoría es de otro tenant', async () => {
  const catalogRepository = new InMemoryCatalogRepository();
  const created = await catalogRepository.create('t1', { name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });
  const useCase = new UpdateCategoryUseCase({ catalogRepository });

  await assert.rejects(
    () => useCase.execute({ tenantId: 't2', categoryId: created.id, name: 'Hackeo' }),
    (err) => {
      assert.equal(err.code, 'CATEGORY_NOT_FOUND');
      return true;
    }
  );
});

test('UpdateCategoryUseCase rechaza si no se envía ningún campo para actualizar', async () => {
  const catalogRepository = new InMemoryCatalogRepository();
  const created = await catalogRepository.create('t1', { name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });
  const useCase = new UpdateCategoryUseCase({ catalogRepository });

  await assert.rejects(
    () => useCase.execute({ tenantId: 't1', categoryId: created.id }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
});

test('UpdateCategoryUseCase rechaza un flujoOperativo inválido', async () => {
  const catalogRepository = new InMemoryCatalogRepository();
  const created = await catalogRepository.create('t1', { name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });
  const useCase = new UpdateCategoryUseCase({ catalogRepository });

  await assert.rejects(
    () => useCase.execute({ tenantId: 't1', categoryId: created.id, flujoOperativo: 'OTRO' }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
});

test('UpdateCategoryUseCase lanza ConflictError al renombrar a un nombre ya usado por otra categoría del tenant', async () => {
  const catalogRepository = new InMemoryCatalogRepository();
  await catalogRepository.create('t1', { name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });
  const otra = await catalogRepository.create('t1', { name: 'Masajes', flujoOperativo: 'TARIFA_ESTANDAR' });
  const useCase = new UpdateCategoryUseCase({ catalogRepository });

  await assert.rejects(
    () => useCase.execute({ tenantId: 't1', categoryId: otra.id, name: 'Peinados' }),
    (err) => {
      assert.equal(err.code, 'CATEGORY_NAME_ALREADY_EXISTS');
      assert.equal(err.statusCode, 409);
      return true;
    }
  );
});

// --- ListCategoriesForTenantUseCase ---

test('ListCategoriesForTenantUseCase solo lista categorías del tenant solicitado', async () => {
  const catalogRepository = new InMemoryCatalogRepository();
  await catalogRepository.create('t1', { name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });
  await catalogRepository.create('t2', { name: 'Masajes', flujoOperativo: 'TARIFA_ESTANDAR' });
  const useCase = new ListCategoriesForTenantUseCase({ catalogRepository });

  const result = await useCase.execute({ tenantId: 't1' });

  assert.equal(result.length, 1);
  assert.equal(result[0].name, 'Peinados');
});

test('ListCategoriesForTenantUseCase con onlyActive=true excluye las desactivadas', async () => {
  const catalogRepository = new InMemoryCatalogRepository();
  const created = await catalogRepository.create('t1', { name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });
  await catalogRepository.setActive('t1', created.id, false);
  const useCase = new ListCategoriesForTenantUseCase({ catalogRepository });

  const result = await useCase.execute({ tenantId: 't1', onlyActive: true });

  assert.equal(result.length, 0);
});

// --- SetCategoryStatusUseCase ---

test('SetCategoryStatusUseCase activa y desactiva una categoría del tenant (flujo operativo)', async () => {
  const catalogRepository = new InMemoryCatalogRepository();
  const created = await catalogRepository.create('t1', { name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });
  const useCase = new SetCategoryStatusUseCase({ catalogRepository });

  const deactivated = await useCase.execute({ tenantId: 't1', categoryId: created.id, active: false });
  assert.equal(deactivated.active, false);

  const reactivated = await useCase.execute({ tenantId: 't1', categoryId: created.id, active: true });
  assert.equal(reactivated.active, true);
});

test('SetCategoryStatusUseCase lanza CATEGORY_NOT_FOUND si la categoría es de otro tenant', async () => {
  const catalogRepository = new InMemoryCatalogRepository();
  const created = await catalogRepository.create('t1', { name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });
  const useCase = new SetCategoryStatusUseCase({ catalogRepository });

  await assert.rejects(
    () => useCase.execute({ tenantId: 't2', categoryId: created.id, active: false }),
    (err) => {
      assert.equal(err.code, 'CATEGORY_NOT_FOUND');
      return true;
    }
  );
});

test('SetCategoryStatusUseCase rechaza si active no es booleano', async () => {
  const catalogRepository = new InMemoryCatalogRepository();
  const created = await catalogRepository.create('t1', { name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });
  const useCase = new SetCategoryStatusUseCase({ catalogRepository });

  await assert.rejects(
    () => useCase.execute({ tenantId: 't1', categoryId: created.id, active: 'si' }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
});
