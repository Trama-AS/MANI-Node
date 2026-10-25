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

// Doble que registra las llamadas del builder, para comprobar qué columnas se escriben y filtran.
function recordingClient(result) {
  const calls = [];
  const builder = {};
  for (const m of ['select', 'eq', 'upsert', 'delete']) {
    builder[m] = (...args) => {
      calls.push([m, ...args]);
      return builder;
    };
  }
  builder.single = async () => result;
  builder.maybeSingle = async () => result;
  return { client: { from: (table) => (calls.push(['from', table]), builder) }, calls };
}

test('create del cliente empresa escribe razon_social, nit, telefono y nombre_representante (HU-M02-07)', async () => {
  const { client, calls } = recordingClient({ data: { id: 'c1' }, error: null });
  const repo = new SupabaseClienteRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await repo.create({
    tenantId: 't1', usuarioId: 'u1', tipo: 'PERSONA_JURIDICA', razonSocial: 'Andina SAS', nit: '900123456-7', telefono: null, nombreRepresentante: 'Laura',
  });

  const upsert = calls.find(([m]) => m === 'upsert');
  assert.deepEqual(upsert[1], {
    tenant_id: 't1', usuario_id: 'u1', tipo: 'PERSONA_JURIDICA', razon_social: 'Andina SAS', nit: '900123456-7', telefono: null, nombre_representante: 'Laura',
  });
});

test('create de persona natural no toca las columnas de organización', async () => {
  const { client, calls } = recordingClient({ data: { id: 'c1' }, error: null });
  const repo = new SupabaseClienteRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await repo.create({ tenantId: 't1', usuarioId: 'u1', tipo: 'PERSONA_NATURAL' });

  assert.deepEqual(calls.find(([m]) => m === 'upsert')[1], { tenant_id: 't1', usuario_id: 'u1', tipo: 'PERSONA_NATURAL' });
});

test('findByNit filtra por tenant y NIT y devuelve la fila o null', async () => {
  const { client, calls } = recordingClient({ data: { id: 'c1', nit: '900123456-7' }, error: null });
  const repo = new SupabaseClienteRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const found = await repo.findByNit('t1', '900123456-7');

  assert.equal(found.id, 'c1');
  assert.deepEqual(calls.filter(([m]) => m === 'eq'), [['eq', 'tenant_id', 't1'], ['eq', 'nit', '900123456-7']]);

  const empty = new SupabaseClienteRepository({ supabaseClientFactory: makeFakeClientFactory(recordingClient({ data: null, error: null }).client) });
  assert.equal(await empty.findByNit('t1', 'x'), null);
});

test('findByNit lanza DomainError INTERNAL_ERROR si Supabase reporta error', async () => {
  const { client } = recordingClient({ data: null, error: { message: 'down' } });
  const repo = new SupabaseClienteRepository({ supabaseClientFactory: makeFakeClientFactory(client) });
  await assert.rejects(() => repo.findByNit('t1', 'x'), (err) => err.code === 'INTERNAL_ERROR');
});
