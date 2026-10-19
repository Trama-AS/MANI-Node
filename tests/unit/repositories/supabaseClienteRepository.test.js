const test = require('node:test');
const assert = require('node:assert/strict');
const SupabaseClienteRepository = require('../../../src/infrastructure/repositories/SupabaseClienteRepository');
const { makeFakeSupabaseClient, makeFakeClientFactory } = require('../../helpers/fakeSupabaseClient');

test('create hace upsert por usuario_id y retorna la fila creada', async () => {
  const client = makeFakeSupabaseClient({
    fromResult: { data: { id: 'c1', usuario_id: 'u1', tenant_id: 't1', tipo: 'PERSONA_NATURAL' }, error: null },
  });
  const repo = new SupabaseClienteRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const result = await repo.create({ tenantId: 't1', usuarioId: 'u1', tipo: 'PERSONA_NATURAL' });

  assert.equal(result.usuario_id, 'u1');
});

test('create lanza DomainError INTERNAL_ERROR si Supabase reporta error', async () => {
  const client = makeFakeSupabaseClient({ fromResult: { data: null, error: { message: 'duplicate key value' } } });
  const repo = new SupabaseClienteRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => repo.create({ tenantId: 't1', usuarioId: 'u1', tipo: 'PERSONA_NATURAL' }),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});

test('deleteByUsuarioId no lanza cuando Supabase no reporta error', async () => {
  const client = makeFakeSupabaseClient({ fromResult: { data: null, error: null } });
  const repo = new SupabaseClienteRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.doesNotReject(() => repo.deleteByUsuarioId('t1', 'u1'));
});

test('deleteByUsuarioId lanza DomainError INTERNAL_ERROR si Supabase reporta error', async () => {
  const client = makeFakeSupabaseClient({ fromResult: { data: null, error: { message: 'down' } } });
  const repo = new SupabaseClienteRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => repo.deleteByUsuarioId('t1', 'u1'),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});

test('findByUsuarioId filtra por tenant y usuario y devuelve cliente.id (distinto del usuario)', async () => {
  const filtros = [];
  const builder = {
    select: () => builder,
    eq: (col, val) => { filtros.push([col, val]); return builder; },
    maybeSingle: async () => ({ data: { id: 'cliente-1', tenant_id: 't1', usuario_id: 'u1', tipo: 'PERSONA_NATURAL' }, error: null }),
  };
  const repo = new SupabaseClienteRepository({ supabaseClientFactory: makeFakeClientFactory({ from: () => builder }) });

  const cliente = await repo.findByUsuarioId('t1', 'u1');

  assert.deepEqual(cliente, { id: 'cliente-1', tenantId: 't1', usuarioId: 'u1', tipo: 'PERSONA_NATURAL' });
  assert.deepEqual(filtros, [['tenant_id', 't1'], ['usuario_id', 'u1']]);
});

test('findByUsuarioId devuelve null si no hay cliente y lanza INTERNAL_ERROR ante error', async () => {
  const vacio = { select: () => vacio, eq: () => vacio, maybeSingle: async () => ({ data: null, error: null }) };
  const falla = { select: () => falla, eq: () => falla, maybeSingle: async () => ({ data: null, error: { message: 'x' } }) };

  assert.equal(await new SupabaseClienteRepository({ supabaseClientFactory: makeFakeClientFactory({ from: () => vacio }) }).findByUsuarioId('t', 'u'), null);
  await assert.rejects(
    () => new SupabaseClienteRepository({ supabaseClientFactory: makeFakeClientFactory({ from: () => falla }) }).findByUsuarioId('t', 'u'),
    (e) => e.code === 'INTERNAL_ERROR'
  );
});
