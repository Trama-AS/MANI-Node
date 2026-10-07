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

function makeChainableClient({ onFrom } = {}) {
  return {
    from: (table) => {
      const builder = {
        select: (...args) => {
          onFrom && onFrom({ table, op: 'select', args });
          return builder;
        },
        eq: (...args) => {
          onFrom && onFrom({ table, op: 'eq', args });
          return builder;
        },
        insert: (payload) => {
          onFrom && onFrom({ table, op: 'insert', payload });
          return builder;
        },
        update: (payload) => {
          onFrom && onFrom({ table, op: 'update', payload });
          return builder;
        },
        single: async () => ({ data: null, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return builder;
    },
  };
}

function withResult(client, table, result) {
  const original = client.from;
  client.from = (t) => {
    const builder = original(t);
    builder.single = async () => result;
    builder.maybeSingle = async () => result;
    // findAllByTenant hace `await query` directamente (sin .single/.maybeSingle);
    // para que eso funcione, el builder debe comportarse como una promesa.
    builder.then = (resolve) => resolve(result);
    return builder;
  };
  return client;
}

test('findAllByTenant filtra por tenant_id y mapea todas las filas', async () => {
  const client = withResult(makeChainableClient(), 'categoria_servicio', {
    data: [{ id: 'c1', nombre: 'Peinados', estado: 'ACTIVO', descripcion: '', tenant_id: 't1' }],
    error: null,
  });
  const repo = new SupabaseCatalogRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const categories = await repo.findAllByTenant('t1');

  assert.equal(categories.length, 1);
  assert.equal(categories[0].tenantId, 't1');
});

test('findAllByTenant lanza DomainError INTERNAL_ERROR si Supabase reporta error', async () => {
  const client = withResult(makeChainableClient(), 'categoria_servicio', { data: null, error: { message: 'down' } });
  const repo = new SupabaseCatalogRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => repo.findAllByTenant('t1'),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});

test('create inserta con tenant_id y estado ACTIVO, retorna la categoría creada', async () => {
  const calls = [];
  const client = withResult(
    makeChainableClient({ onFrom: (c) => calls.push(c) }),
    'categoria_servicio',
    { data: { id: 'c1', nombre: 'Peinados', estado: 'ACTIVO', descripcion: null, tenant_id: 't1' }, error: null }
  );
  const repo = new SupabaseCatalogRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const category = await repo.create('t1', { name: 'Peinados' });

  assert.equal(category.id, 'c1');
  assert.equal(category.active, true);
  const insertCall = calls.find((c) => c.op === 'insert');
  assert.equal(insertCall.payload.tenant_id, 't1');
  assert.equal(insertCall.payload.estado, 'ACTIVO');
});

test('create lanza DomainError INTERNAL_ERROR si Supabase reporta error', async () => {
  const client = withResult(makeChainableClient(), 'categoria_servicio', { data: null, error: { message: 'down' } });
  const repo = new SupabaseCatalogRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => repo.create('t1', { name: 'Peinados' }),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});

test('update retorna null (sin lanzar) cuando maybeSingle no encuentra fila para ese tenant', async () => {
  const client = withResult(makeChainableClient(), 'categoria_servicio', { data: null, error: null });
  const repo = new SupabaseCatalogRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  assert.equal(await repo.update('t1', 'no-existe', { name: 'x' }), null);
});

test('update lanza DomainError INTERNAL_ERROR si Supabase reporta error', async () => {
  const client = withResult(makeChainableClient(), 'categoria_servicio', { data: null, error: { message: 'down' } });
  const repo = new SupabaseCatalogRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => repo.update('t1', 'c1', { name: 'x' }),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});

test('setActive traduce active=false a estado INACTIVO', async () => {
  const calls = [];
  const client = withResult(
    makeChainableClient({ onFrom: (c) => calls.push(c) }),
    'categoria_servicio',
    { data: { id: 'c1', nombre: 'Peinados', estado: 'INACTIVO', descripcion: null, tenant_id: 't1' }, error: null }
  );
  const repo = new SupabaseCatalogRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const category = await repo.setActive('t1', 'c1', false);

  assert.equal(category.active, false);
  const updateCall = calls.find((c) => c.op === 'update');
  assert.equal(updateCall.payload.estado, 'INACTIVO');
});

test('setActive lanza DomainError INTERNAL_ERROR si Supabase reporta error', async () => {
  const client = withResult(makeChainableClient(), 'categoria_servicio', { data: null, error: { message: 'down' } });
  const repo = new SupabaseCatalogRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => repo.setActive('t1', 'c1', true),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});
