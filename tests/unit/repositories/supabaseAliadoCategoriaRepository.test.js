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
