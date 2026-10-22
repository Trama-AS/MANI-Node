const test = require('node:test');
const assert = require('node:assert/strict');
const SupabaseAliadoCategoriaRepository = require('../../../src/infrastructure/repositories/SupabaseAliadoCategoriaRepository');
const { makeFakeClientFactory } = require('../../helpers/fakeSupabaseClient');

function makeInsertClient(result) {
  return {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: async () => result,
        }),
      }),
    }),
  };
}

test('create inserta la fila aliado_categoria y retorna el registro creado', async () => {
  const client = makeInsertClient({ data: { id: 'ac1', aliado_id: 'a1', categoria_id: 'c1' }, error: null });
  const repo = new SupabaseAliadoCategoriaRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const result = await repo.create({ tenantId: 't1', aliadoId: 'a1', categoriaId: 'c1' });

  assert.equal(result.id, 'ac1');
});

test('create lanza DomainError INTERNAL_ERROR si Supabase reporta error (p. ej. trigger de tenant distinto)', async () => {
  const client = makeInsertClient({ data: null, error: { message: 'MANI-CAT-422C' } });
  const repo = new SupabaseAliadoCategoriaRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => repo.create({ tenantId: 't1', aliadoId: 'a1', categoriaId: 'c1' }),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});

test('findByAliadoId retorna lista de IDs de categorías', async () => {
  const fakeClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({
            data: [{ categoria_id: 'c1' }, { categoria_id: 'c2' }],
            error: null,
          }),
        }),
      }),
    }),
  };
  const repo = new SupabaseAliadoCategoriaRepository({ supabaseClientFactory: makeFakeClientFactory(fakeClient) });

  const result = await repo.findByAliadoId('t1', 'a1');

  assert.deepEqual(result, ['c1', 'c2']);
});

test('setAliadoCategorias actualiza la asociación de categorías del aliado', async () => {
  let deleted = false;
  let inserted = false;
  let selectCount = 0;

  const fakeClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => {
            selectCount++;
            if (selectCount === 1) {
              // Current categories before update
              return { data: [{ categoria_id: 'c1' }], error: null };
            }
            // Categories after update
            return { data: [{ categoria_id: 'c2' }, { categoria_id: 'c3' }], error: null };
          },
        }),
      }),
      delete: () => ({
        eq: () => ({
          in: () => ({
            eq: async () => {
              deleted = true;
              return { error: null };
            },
          }),
        }),
      }),
      insert: async () => {
        inserted = true;
        return { error: null };
      },
    }),
  };
  const repo = new SupabaseAliadoCategoriaRepository({ supabaseClientFactory: makeFakeClientFactory(fakeClient) });

  const result = await repo.setAliadoCategorias('t1', 'a1', ['c2', 'c3']);

  assert.ok(deleted);
  assert.ok(inserted);
  assert.deepEqual(result, ['c2', 'c3']);
});
