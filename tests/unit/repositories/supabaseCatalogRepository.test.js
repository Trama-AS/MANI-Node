const test = require('node:test');
const assert = require('node:assert/strict');
const SupabaseCatalogRepository = require('../../../src/infrastructure/repositories/SupabaseCatalogRepository');
const { makeFakeSupabaseClient, makeFakeClientFactory } = require('../../helpers/fakeSupabaseClient');

test('findById traduce estado ACTIVO/INACTIVO a un Category de dominio', async () => {
  const client = makeFakeSupabaseClient({ fromResult: { data: { id: 'c1', nombre: 'Plomería', estado: 'ACTIVO' }, error: null } });
  const repo = new SupabaseCatalogRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const category = await repo.findById('t1', 'c1');

  assert.equal(category.id, 'c1');
  assert.equal(category.name, 'Plomería');
  assert.equal(category.active, true);
});

test('findById retorna null cuando la categoría no existe', async () => {
  const client = makeFakeSupabaseClient({ fromResult: { data: null, error: null } });
  const repo = new SupabaseCatalogRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  assert.equal(await repo.findById('t1', 'no-existe'), null);
});

test('findById lanza DomainError INTERNAL_ERROR si Supabase reporta error', async () => {
  const client = makeFakeSupabaseClient({ fromResult: { data: null, error: { message: 'down' } } });
  const repo = new SupabaseCatalogRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => repo.findById('t1', 'c1'),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});

test('findAllCategories mapea todas las filas a Category', async () => {
  const client = {
    from: () => ({
      select: async () => ({
        data: [{ id: 'c1', nombre: 'Plomería', estado: 'ACTIVO' }],
        error: null,
      }),
    }),
  };
  const repo = new SupabaseCatalogRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const categories = await repo.findAllCategories();

  assert.equal(categories.length, 1);
  assert.equal(categories[0].name, 'Plomería');
});

test('findAllCategories lanza DomainError INTERNAL_ERROR si Supabase reporta error', async () => {
  const client = { from: () => ({ select: async () => ({ data: null, error: { message: 'down' } }) }) };
  const repo = new SupabaseCatalogRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => repo.findAllCategories(),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});
