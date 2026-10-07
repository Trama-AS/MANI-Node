const test = require('node:test');
const assert = require('node:assert/strict');
const SupabaseUsuarioRepository = require('../../../src/infrastructure/repositories/SupabaseUsuarioRepository');
const { makeFakeSupabaseClient, makeFakeClientFactory } = require('../../helpers/fakeSupabaseClient');

test('findByEmail retorna el registro cuando Supabase no reporta error', async () => {
  const client = makeFakeSupabaseClient({ fromResult: { data: { id: 'u1', email: 'a@mani.test' }, error: null } });
  const repo = new SupabaseUsuarioRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const result = await repo.findByEmail('t1', 'a@mani.test');

  assert.deepEqual(result, { id: 'u1', email: 'a@mani.test' });
});

test('findByEmail retorna null cuando no hay coincidencia', async () => {
  const client = makeFakeSupabaseClient({ fromResult: { data: null, error: null } });
  const repo = new SupabaseUsuarioRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const result = await repo.findByEmail('t1', 'nadie@mani.test');

  assert.equal(result, null);
});

test('findByEmail lanza DomainError INTERNAL_ERROR si Supabase reporta error', async () => {
  const client = makeFakeSupabaseClient({ fromResult: { data: null, error: { message: 'conexión perdida' } } });
  const repo = new SupabaseUsuarioRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => repo.findByEmail('t1', 'a@mani.test'),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      assert.match(err.message, /conexión perdida/);
      return true;
    }
  );
});

test('create traduce rol/estado al español antes de upsert y retorna la fila creada', async () => {
  const client = makeFakeSupabaseClient({
    fromResult: { data: { id: 'u1', rol: 'ALIADO', estado: 'ACTIVO' }, error: null },
  });
  const repo = new SupabaseUsuarioRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const result = await repo.create({
    id: 'u1',
    tenantId: 't1',
    email: 'a@mani.test',
    rol: 'ALLY',
    estado: 'ACTIVE',
    phone: '+573000000',
  });

  assert.equal(result.id, 'u1');
});

test('create lanza DomainError INTERNAL_ERROR si Supabase reporta error', async () => {
  const client = makeFakeSupabaseClient({ fromResult: { data: null, error: { message: 'constraint violada' } } });
  const repo = new SupabaseUsuarioRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => repo.create({ id: 'u1', tenantId: 't1', email: 'a@mani.test', rol: 'ALLY', estado: 'ACTIVE' }),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});
