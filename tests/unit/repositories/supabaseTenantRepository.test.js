const test = require('node:test');
const assert = require('node:assert/strict');
const SupabaseTenantRepository = require('../../../src/infrastructure/repositories/SupabaseTenantRepository');
const { makeFakeSupabaseClient, makeFakeClientFactory } = require('../../helpers/fakeSupabaseClient');

test('findById traduce estado de español a inglés y retorna un Tenant de dominio', async () => {
  const client = makeFakeSupabaseClient({
    fromResult: { data: { id: 't1', nombre: 'Demo', estado: 'ACTIVO' }, error: null },
  });
  const repo = new SupabaseTenantRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const tenant = await repo.findById('t1');

  assert.equal(tenant.id, 't1');
  assert.equal(tenant.name, 'Demo');
  assert.equal(tenant.status, 'ACTIVE');
});

test('findById retorna null cuando el tenant no existe', async () => {
  const client = makeFakeSupabaseClient({ fromResult: { data: null, error: null } });
  const repo = new SupabaseTenantRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const tenant = await repo.findById('no-existe');

  assert.equal(tenant, null);
});

test('findById lanza DomainError INTERNAL_ERROR si Supabase reporta error', async () => {
  const client = makeFakeSupabaseClient({ fromResult: { data: null, error: { message: 'down' } } });
  const repo = new SupabaseTenantRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => repo.findById('t1'),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});
