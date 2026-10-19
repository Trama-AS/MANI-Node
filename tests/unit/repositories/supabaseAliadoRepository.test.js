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
