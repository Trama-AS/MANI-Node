const test = require('node:test');
const assert = require('node:assert/strict');
const SupabaseSitioRepository = require('../../../src/infrastructure/repositories/SupabaseSitioRepository');
const { makeFakeSupabaseClient, makeFakeClientFactory } = require('../../helpers/fakeSupabaseClient');

test('findFirstActiveZonaId retorna el id cuando existe una zona activa', async () => {
  const client = makeFakeSupabaseClient({ fromResult: { data: { id: 'z1' }, error: null } });
  const repo = new SupabaseSitioRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  assert.equal(await repo.findFirstActiveZonaId(), 'z1');
});

test('findFirstActiveZonaId retorna null cuando no hay ninguna zona activa', async () => {
  const client = makeFakeSupabaseClient({ fromResult: { data: null, error: null } });
  const repo = new SupabaseSitioRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  assert.equal(await repo.findFirstActiveZonaId(), null);
});

test('findFirstActiveZonaId lanza DomainError INTERNAL_ERROR si Supabase reporta error', async () => {
  const client = makeFakeSupabaseClient({ fromResult: { data: null, error: { message: 'down' } } });
  const repo = new SupabaseSitioRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => repo.findFirstActiveZonaId(),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});

test('create inserta el sitio con tenant_id/cliente_id/zona_id/reglas y retorna la fila creada', async () => {
  const client = makeFakeSupabaseClient({
    fromResult: { data: { id: 's1', tenant_id: 't1', cliente_id: 'c1', zona_id: 'z1' }, error: null },
  });
  const repo = new SupabaseSitioRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const result = await repo.create({
    tenantId: 't1',
    clienteId: 'c1',
    zonaId: 'z1',
    direccion: 'Calle 1 # 2-3',
    reglas: { nombre_contacto: 'Juan', telefono: '300' },
  });

  assert.equal(result.id, 's1');
});

test('create lanza DomainError INTERNAL_ERROR si Supabase reporta error', async () => {
  const client = makeFakeSupabaseClient({ fromResult: { data: null, error: { message: 'down' } } });
  const repo = new SupabaseSitioRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () =>
      repo.create({ tenantId: 't1', clienteId: 'c1', zonaId: 'z1', direccion: 'x', reglas: {} }),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});

test('deleteByClienteId no lanza cuando Supabase no reporta error', async () => {
  const client = makeFakeSupabaseClient({ fromResult: { data: null, error: null } });
  const repo = new SupabaseSitioRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.doesNotReject(() => repo.deleteByClienteId('t1', 'c1'));
});

test('deleteByClienteId lanza DomainError INTERNAL_ERROR si Supabase reporta error', async () => {
  const client = makeFakeSupabaseClient({ fromResult: { data: null, error: { message: 'down' } } });
  const repo = new SupabaseSitioRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => repo.deleteByClienteId('t1', 'c1'),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});
