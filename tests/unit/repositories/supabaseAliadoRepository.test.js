const test = require('node:test');
const assert = require('node:assert/strict');
const SupabaseAliadoRepository = require('../../../src/infrastructure/repositories/SupabaseAliadoRepository');
const { makeFakeSupabaseClient, makeFakeClientFactory } = require('../../helpers/fakeSupabaseClient');

test('findByDocumentNumber retorna el registro cuando existe', async () => {
  const client = makeFakeSupabaseClient({ fromResult: { data: { id: 'a1', usuario_id: 'u1' }, error: null } });
  const repo = new SupabaseAliadoRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const result = await repo.findByDocumentNumber('t1', '123');

  assert.equal(result.usuario_id, 'u1');
});

test('findByDocumentNumber lanza DomainError INTERNAL_ERROR si Supabase reporta error', async () => {
  const client = makeFakeSupabaseClient({ fromResult: { data: null, error: { message: 'timeout' } } });
  const repo = new SupabaseAliadoRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => repo.findByDocumentNumber('t1', '123'),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});

test('create traduce estadoVerificacion al español antes de upsert', async () => {
  const client = makeFakeSupabaseClient({
    fromResult: { data: { id: 'a1', estado_verificacion: 'PENDIENTE' }, error: null },
  });
  const repo = new SupabaseAliadoRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const result = await repo.create({
    tenantId: 't1',
    usuarioId: 'u1',
    tipo: 'PERSONA_NATURAL',
    nombreRazonSocial: 'Maria',
    estadoVerificacion: 'PENDING',
    documentType: 'CC',
    documentNumber: '123',
  });

  assert.equal(result.estado_verificacion, 'PENDIENTE');
});

test('create lanza DomainError INTERNAL_ERROR si Supabase reporta error (p. ej. constraint de documento duplicado)', async () => {
  const client = makeFakeSupabaseClient({ fromResult: { data: null, error: { message: 'duplicate key value' } } });
  const repo = new SupabaseAliadoRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () =>
      repo.create({
        tenantId: 't1',
        usuarioId: 'u1',
        tipo: 'PERSONA_NATURAL',
        nombreRazonSocial: 'Maria',
        estadoVerificacion: 'PENDING',
        documentType: 'CC',
        documentNumber: '123',
      }),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});

test('findByUsuarioId retorna el aliado cuando existe', async () => {
  const client = makeFakeSupabaseClient({
    fromResult: { data: { id: 'a1', usuario_id: 'u1', tenant_id: 't1' }, error: null },
  });
  const repo = new SupabaseAliadoRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const result = await repo.findByUsuarioId('t1', 'u1');

  assert.equal(result.id, 'a1');
  assert.equal(result.usuario_id, 'u1');
});

test('findByUsuarioId lanza DomainError INTERNAL_ERROR si Supabase reporta error', async () => {
  const client = makeFakeSupabaseClient({ fromResult: { data: null, error: { message: 'db error' } } });
  const repo = new SupabaseAliadoRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => repo.findByUsuarioId('t1', 'u1'),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});

// Registra el payload de .update() y los filtros .eq() de la cadena de supabase-js.
function makeRecordingClient(result) {
  const calls = { table: null, update: null, eq: [] };
  const builder = {
    update: (payload) => { calls.update = payload; return builder; },
    eq: (column, value) => { calls.eq.push([column, value]); return builder; },
    select: () => builder,
    maybeSingle: async () => result,
  };
  return { calls, client: { from: (table) => { calls.table = table; return builder; } } };
}

test('updateVerificationStatus guarda verificado_por (CA-5) y actualiza solo si sigue PENDIENTE en el tenant', async () => {
  const { calls, client } = makeRecordingClient({ data: { id: 'a1', estado_verificacion: 'VERIFICADO' }, error: null });
  const repo = new SupabaseAliadoRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const result = await repo.updateVerificationStatus('t1', 'a1', {
    estadoVerificacion: 'VERIFIED',
    fechaVerificacion: '2026-10-19T00:00:00.000Z',
    verificadoPor: 'admin-1',
  });

  assert.equal(result.estado_verificacion, 'VERIFICADO');
  assert.equal(calls.table, 'aliado');
  assert.deepEqual(calls.update, {
    estado_verificacion: 'VERIFICADO',
    motivo_rechazo: null,
    fecha_verificacion: '2026-10-19T00:00:00.000Z',
    verificado_por: 'admin-1',
  });
  assert.deepEqual(calls.eq, [['tenant_id', 't1'], ['id', 'a1'], ['estado_verificacion', 'PENDIENTE']]);
});

test('updateVerificationStatus devuelve null cuando otro administrador ya resolvió (0 filas)', async () => {
  const { client } = makeRecordingClient({ data: null, error: null });
  const repo = new SupabaseAliadoRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const result = await repo.updateVerificationStatus('t1', 'a1', { estadoVerificacion: 'REJECTED', motivoRechazo: 'x', verificadoPor: 'admin-1' });

  assert.equal(result, null);
});

test('updateVerificationStatus lanza INTERNAL_ERROR si Supabase reporta error', async () => {
  const { client } = makeRecordingClient({ data: null, error: { message: 'timeout' } });
  const repo = new SupabaseAliadoRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => repo.updateVerificationStatus('t1', 'a1', { estadoVerificacion: 'VERIFIED', verificadoPor: 'admin-1' }),
    (err) => err.code === 'INTERNAL_ERROR'
  );
});

test('create persiste nombreRepresentante y docRepresentante en payload de aliado empresa', async () => {
  let capturedPayload = null;
  const client = {
    from: () => ({
      upsert: (payload) => {
        capturedPayload = payload;
        return {
          select: () => ({
            single: async () => ({ data: { id: 'a-emp-1', ...payload }, error: null }),
          }),
        };
      },
    }),
  };
  const repo = new SupabaseAliadoRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const result = await repo.create({
    tenantId: 't1',
    usuarioId: 'u-emp-1',
    tipo: 'PERSONA_JURIDICA',
    nombreRazonSocial: 'Empresa SAS',
    estadoVerificacion: 'PENDING',
    documentType: 'NIT',
    documentNumber: '900123456',
    nombreRepresentante: 'Carlos Mario',
    docRepresentante: '10203040',
  });

  assert.equal(capturedPayload.nombre_representante_legal, 'Carlos Mario');
  assert.equal(capturedPayload.documento_representante_legal, '10203040');
  assert.equal(result.id, 'a-emp-1');
});
