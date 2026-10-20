const test = require('node:test');
const assert = require('node:assert/strict');
const CreateCategoryUseCase = require('../../../../src/application/useCases/catalog/CreateCategoryUseCase');
const UpdateCategoryUseCase = require('../../../../src/application/useCases/catalog/UpdateCategoryUseCase');
const GetCategoryUseCase = require('../../../../src/application/useCases/catalog/GetCategoryUseCase');
const ListCategoriesForTenantUseCase = require('../../../../src/application/useCases/catalog/ListCategoriesForTenantUseCase');
const SetCategoryStatusUseCase = require('../../../../src/application/useCases/catalog/SetCategoryStatusUseCase');
const InMemoryCatalogRepository = require('../../../../src/infrastructure/repositories/InMemoryCatalogRepository');
const RuleEvaluationResult = require('../../../../src/domain/entities/RuleEvaluationResult');
const { DomainError } = require('../../../../src/domain/errors/DomainError');

// Doble del Rules Service: aprueba normalizando como Rules, o devuelve las
// violaciones indicadas. Registra cada llamada para verificar la delegación.
function fakeRules({ violations = [] } = {}) {
  const calls = [];
  return {
    calls,
    async evaluateCategoryRules(params) {
      calls.push(params);
      const { name, flujoOperativo } = params.context;
      return new RuleEvaluationResult({
        allowed: violations.length === 0,
        ruleSetVersion: 'test-v1',
        violations,
        normalized: {
          name: name == null ? null : name.trim().replace(/\s+/g, ' '),
          flujoOperativo: flujoOperativo == null ? null : flujoOperativo.trim().toUpperCase(),
        },
      });
    },
  };
}

// --- CreateCategoryUseCase ---

test('CreateCategoryUseCase crea una categoría activa asociada al tenant, con su flujoOperativo', async () => {
  const catalogRepository = new InMemoryCatalogRepository();
  const useCase = new CreateCategoryUseCase({ catalogRepository, ruleEvaluationService: fakeRules() });

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
  const useCase = new CreateCategoryUseCase({ catalogRepository: new InMemoryCatalogRepository(), ruleEvaluationService: fakeRules() });

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
});

test('CreateCategoryUseCase delega en Rules (CREATE, tenant, rol, correlación) y persiste los valores normalizados', async () => {
  const rules = fakeRules();
  const useCase = new CreateCategoryUseCase({ catalogRepository: new InMemoryCatalogRepository(), ruleEvaluationService: rules });

  const result = await useCase.execute({
    tenantId: 't1',
    name: '  Peinados   de Novia ',
    flujoOperativo: 'tarifa_estandar',
    role: 'ADMIN',
    correlationId: 'corr-1',
  });

  assert.deepEqual(rules.calls, [
    {
      tenantId: 't1',
      categoryId: null,
      role: 'ADMIN',
      correlationId: 'corr-1',
      context: { operation: 'CREATE', name: '  Peinados   de Novia ', flujoOperativo: 'tarifa_estandar' },
    },
  ]);
  assert.equal(result.name, 'Peinados de Novia');
  assert.equal(result.flujoOperativo, 'TARIFA_ESTANDAR');
});

test('CreateCategoryUseCase lanza RuleViolationError (400) con las violaciones de Rules y no persiste', async () => {
  const catalogRepository = new InMemoryCatalogRepository();
  const violations = [{ code: 'MANI-CAT-422F', field: 'flujoOperativo', message: 'flujo operativo inválido (INVALIDO)' }];
  const useCase = new CreateCategoryUseCase({ catalogRepository, ruleEvaluationService: fakeRules({ violations }) });

  await assert.rejects(
    () => useCase.execute({ tenantId: 't1', name: 'Peinados', flujoOperativo: 'INVALIDO' }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      assert.equal(err.statusCode, 400);
      assert.deepEqual(err.violations, violations);
      assert.match(err.message, /flujo operativo inválido/);
      return true;
    }
  );
  assert.deepEqual(await catalogRepository.findAllByTenant('t1'), []);
});

test('CreateCategoryUseCase no consulta a Rules si la petición está mal formada', async () => {
  const rules = fakeRules();
  const useCase = new CreateCategoryUseCase({ catalogRepository: new InMemoryCatalogRepository(), ruleEvaluationService: rules });

  await assert.rejects(() => useCase.execute({ tenantId: 't1', flujoOperativo: 'TARIFA_ESTANDAR' }));
  assert.equal(rules.calls.length, 0);
});

test('CreateCategoryUseCase propaga el 503 cuando Rules no está disponible', async () => {
  const useCase = new CreateCategoryUseCase({
    catalogRepository: new InMemoryCatalogRepository(),
    ruleEvaluationService: {
      async evaluateCategoryRules() {
        throw new DomainError('caído', 'RULES_SERVICE_UNAVAILABLE', 503);
      },
    },
  });

  await assert.rejects(
    () => useCase.execute({ tenantId: 't1', name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' }),
    (err) => err.statusCode === 503 && err.code === 'RULES_SERVICE_UNAVAILABLE'
  );
});

test('CreateCategoryUseCase y UpdateCategoryUseCase exigen ruleEvaluationService', () => {
  assert.throws(() => new CreateCategoryUseCase({ catalogRepository: new InMemoryCatalogRepository() }), /ruleEvaluationService/);
  assert.throws(() => new UpdateCategoryUseCase({ catalogRepository: new InMemoryCatalogRepository() }), /ruleEvaluationService/);
});

test('CreateCategoryUseCase lanza ConflictError CATEGORY_NAME_ALREADY_EXISTS si el nombre ya existe en el tenant', async () => {
  const catalogRepository = new InMemoryCatalogRepository();
  const useCase = new CreateCategoryUseCase({ catalogRepository, ruleEvaluationService: fakeRules() });
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
  const useCase = new UpdateCategoryUseCase({ catalogRepository, ruleEvaluationService: fakeRules() });

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
  const useCase = new UpdateCategoryUseCase({ catalogRepository, ruleEvaluationService: fakeRules() });

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
  const useCase = new UpdateCategoryUseCase({ catalogRepository, ruleEvaluationService: fakeRules() });

  await assert.rejects(
    () => useCase.execute({ tenantId: 't1', categoryId: created.id }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      return true;
    }
  );
});

test('UpdateCategoryUseCase rechaza un flujoOperativo que Rules no aprueba, sin modificar la categoría', async () => {
  const catalogRepository = new InMemoryCatalogRepository();
  const created = await catalogRepository.create('t1', { name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });
  const violations = [{ code: 'MANI-CAT-422F', field: 'flujoOperativo', message: 'flujo operativo inválido (OTRO)' }];
  const useCase = new UpdateCategoryUseCase({ catalogRepository, ruleEvaluationService: fakeRules({ violations }) });

  await assert.rejects(
    () => useCase.execute({ tenantId: 't1', categoryId: created.id, flujoOperativo: 'OTRO' }),
    (err) => {
      assert.equal(err.code, 'VALIDATION_ERROR');
      assert.deepEqual(err.violations, violations);
      return true;
    }
  );
  assert.equal((await catalogRepository.findById('t1', created.id)).flujoOperativo, 'TARIFA_ESTANDAR');
});

test('UpdateCategoryUseCase evalúa UPDATE solo con los campos enviados y no consulta Rules si solo cambia description', async () => {
  const catalogRepository = new InMemoryCatalogRepository();
  const created = await catalogRepository.create('t1', { name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });
  const rules = fakeRules();
  const useCase = new UpdateCategoryUseCase({ catalogRepository, ruleEvaluationService: rules });

  await useCase.execute({ tenantId: 't1', categoryId: created.id, description: 'nueva', role: 'ADMIN' });
  assert.equal(rules.calls.length, 0);

  const result = await useCase.execute({ tenantId: 't1', categoryId: created.id, name: ' Peinados  Pro ', role: 'ADMIN' });
  assert.deepEqual(rules.calls[0].context, { operation: 'UPDATE', name: ' Peinados  Pro ', flujoOperativo: undefined });
  assert.equal(rules.calls[0].categoryId, created.id);
  assert.equal(result.name, 'Peinados Pro');
  assert.equal(result.flujoOperativo, 'TARIFA_ESTANDAR');
});

test('UpdateCategoryUseCase lanza ConflictError al renombrar a un nombre ya usado por otra categoría del tenant', async () => {
  const catalogRepository = new InMemoryCatalogRepository();
  await catalogRepository.create('t1', { name: 'Peinados', flujoOperativo: 'TARIFA_ESTANDAR' });
  const otra = await catalogRepository.create('t1', { name: 'Masajes', flujoOperativo: 'TARIFA_ESTANDAR' });
  const useCase = new UpdateCategoryUseCase({ catalogRepository, ruleEvaluationService: fakeRules() });

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

// --- Filas históricas y reglas: en US-03.1.1-M6 las reglas las decide Rules, no Core ---

test('UpdateCategoryUseCase edita una categoría histórica fuera de reglas: Core no la revalida y Rules solo evalúa lo que cambia', async () => {
  const Category = require('../../../../src/domain/entities/Category');
  const catalogRepository = new InMemoryCatalogRepository();
  // Fila histórica: nombre de 2 caracteres y sin flujo operativo (seed QA).
  catalogRepository.categories.push(new Category({ id: 'hist-1', name: 'AB', tenantId: 't1', flujoOperativo: null }));
  const rules = fakeRules();
  const useCase = new UpdateCategoryUseCase({ catalogRepository, ruleEvaluationService: rules });

  const result = await useCase.execute({ tenantId: 't1', categoryId: 'hist-1', flujoOperativo: 'cotizacion_previa', role: 'ADMIN' });

  assert.equal(result.name, 'AB');
  assert.equal(result.flujoOperativo, 'COTIZACION_PREVIA');
  assert.deepEqual(rules.calls[0].context, { operation: 'UPDATE', name: undefined, flujoOperativo: 'cotizacion_previa' });
});

test('CreateCategoryUseCase no aplica reglas locales de nombre: el veredicto es el de Rules', async () => {
  const catalogRepository = new InMemoryCatalogRepository();
  // Rules aprueba un nombre de 2 caracteres (p. ej. override por tenant): Core lo acepta.
  const useCase = new CreateCategoryUseCase({ catalogRepository, ruleEvaluationService: fakeRules() });

  const created = await useCase.execute({ tenantId: 't1', name: '  A   B ', flujoOperativo: 'TARIFA_ESTANDAR', role: 'ADMIN' });

  assert.equal(created.name, 'A B');
});
