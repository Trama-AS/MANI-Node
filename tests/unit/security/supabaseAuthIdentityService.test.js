const test = require('node:test');
const assert = require('node:assert/strict');
const SupabaseAuthIdentityService = require('../../../src/infrastructure/security/SupabaseAuthIdentityService');
const { makeFakeClientFactory } = require('../../helpers/fakeSupabaseClient');

function makeAuthClient({ createUserResult, signInResult }) {
  return {
    auth: {
      admin: { createUser: async () => createUserResult },
      signInWithPassword: async () => signInResult,
    },
  };
}

test('createIdentity crea el usuario en Supabase Auth e inicia sesión para obtener tokens reales', async () => {
  const client = makeAuthClient({
    createUserResult: { data: { user: { id: 'auth-user-1' } }, error: null },
    signInResult: {
      data: { session: { access_token: 'at', refresh_token: 'rt', expires_in: 3600 } },
      error: null,
    },
  });
  const service = new SupabaseAuthIdentityService({ supabaseClientFactory: makeFakeClientFactory(client) });

  const identity = await service.createIdentity({
    tenantId: 't1',
    email: 'a@mani.test',
    password: 'Cambiar123!',
    role: 'ALLY',
  });

  assert.deepEqual(identity, { userId: 'auth-user-1', accessToken: 'at', refreshToken: 'rt', expiresIn: 3600 });
});

test('createIdentity lanza ConflictError EMAIL_ALREADY_REGISTERED si Supabase Auth reporta email duplicado', async () => {
  const client = makeAuthClient({
    createUserResult: { data: null, error: { message: 'User already registered' } },
    signInResult: { data: {}, error: null },
  });
  const service = new SupabaseAuthIdentityService({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => service.createIdentity({ tenantId: 't1', email: 'a@mani.test', password: 'x', role: 'ALLY' }),
    (err) => {
      assert.equal(err.code, 'EMAIL_ALREADY_REGISTERED');
      assert.equal(err.statusCode, 409);
      return true;
    }
  );
});

test('createIdentity lanza DomainError INTERNAL_ERROR para otros errores de Supabase Auth al crear', async () => {
  const client = makeAuthClient({
    createUserResult: { data: null, error: { message: 'service unavailable' } },
    signInResult: { data: {}, error: null },
  });
  const service = new SupabaseAuthIdentityService({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => service.createIdentity({ tenantId: 't1', email: 'a@mani.test', password: 'x', role: 'ALLY' }),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});

test('createIdentity lanza DomainError INTERNAL_ERROR si el usuario se crea pero el sign-in posterior falla', async () => {
  const client = makeAuthClient({
    createUserResult: { data: { user: { id: 'auth-user-1' } }, error: null },
    signInResult: { data: { session: null }, error: { message: 'invalid grant' } },
  });
  const service = new SupabaseAuthIdentityService({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => service.createIdentity({ tenantId: 't1', email: 'a@mani.test', password: 'x', role: 'ALLY' }),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});
