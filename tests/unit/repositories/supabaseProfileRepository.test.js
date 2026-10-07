const test = require('node:test');
const assert = require('node:assert/strict');
const SupabaseProfileRepository = require('../../../src/infrastructure/repositories/SupabaseProfileRepository');
const { makeFakeClientFactory } = require('../../helpers/fakeSupabaseClient');

function makeClient({ usuario, aliado, usuarioError, aliadoError }) {
  return {
    from: (table) => {
      if (table === 'usuario') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: usuario, error: usuarioError || null }) }),
              maybeSingle: async () => ({ data: usuario, error: usuarioError || null }),
            }),
          }),
        };
      }
      if (table === 'aliado') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: aliado, error: aliadoError || null }) }),
          }),
        };
      }
      throw new Error(`tabla inesperada: ${table}`);
    },
  };
}

test('findByUserId retorna null cuando no hay usuario con ese id/tenant (B4: sin fallback a perfil demo)', async () => {
  const client = makeClient({ usuario: null });
  const repo = new SupabaseProfileRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const profile = await repo.findByUserId('user-que-no-existe', 't1');

  assert.equal(profile, null);
});

test('findByUserId de un ALIADO combina usuario + aliado (nombre y estado de verificación)', async () => {
  const client = makeClient({
    usuario: { id: 'u1', tenant_id: 't1', email: 'a@mani.test', rol: 'ALIADO', estado: 'ACTIVO' },
    aliado: { nombre_razon_social: 'María Pérez', estado_verificacion: 'PENDIENTE' },
  });
  const repo = new SupabaseProfileRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  const profile = await repo.findByUserId('u1', 't1');

  assert.equal(profile.role, 'ALLY');
  assert.equal(profile.fullName, 'María Pérez');
  assert.equal(profile.status, 'PENDING');
  assert.equal(profile.tenantId, 't1');
});

test('findByUserId lanza DomainError INTERNAL_ERROR si Supabase reporta error', async () => {
  const client = makeClient({ usuario: null, usuarioError: { message: 'down' } });
  const repo = new SupabaseProfileRepository({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => repo.findByUserId('u1', 't1'),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});
