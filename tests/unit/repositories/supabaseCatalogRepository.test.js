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

test('findActiveByTenant filtra por tenant_id y estado ACTIVO, ordena por nombre y mapea a Category', async () => {
  const filters = [];
  const orders = [];
  const builder = {
    select: () => builder,
    eq: (col, val) => {
      filters.push([col, val]);
      return builder;
    },
    order: (col, opts) => {
      orders.push([col, opts]);
      return Promise.resolve({ data: [{ id: 'c1', nombre: 'Electricidad', estado: 'ACTIVO' }], error: null });
    },
  };
  const repo = new SupabaseCatalogRepository({ supabaseClientFactory: makeFakeClientFactory({ from: () => builder }) });

  const categories = await repo.findActiveByTenant('t1');

  assert.deepEqual(filters, [['tenant_id', 't1'], ['estado', 'ACTIVO']]);
  assert.deepEqual(orders, [['nombre', { ascending: true }]]);
  assert.equal(categories.length, 1);
  assert.equal(categories[0].name, 'Electricidad');
  assert.equal(categories[0].isActive(), true);
});

test('findActiveByTenant lanza DomainError INTERNAL_ERROR si Supabase reporta error', async () => {
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: async () => ({ data: null, error: { message: 'down' } }),
  };
  const repo = new SupabaseCatalogRepository({ supabaseClientFactory: makeFakeClientFactory({ from: () => builder }) });

  await assert.rejects(
    () => repo.findActiveByTenant('t1'),
    (err) => err.code === 'INTERNAL_ERROR'
  );
});
