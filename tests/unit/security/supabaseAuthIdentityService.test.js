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

test('createUser crea la cuenta en Supabase Auth y retorna solo el userId (sin iniciar sesión)', async () => {
  const client = makeAuthClient({
    createUserResult: { data: { user: { id: 'auth-user-1' } }, error: null },
    signInResult: { data: {}, error: null },
  });
  const service = new SupabaseAuthIdentityService({ supabaseClientFactory: makeFakeClientFactory(client) });

  const result = await service.createUser({ email: 'a@mani.test', password: 'Cambiar123!' });

  assert.deepEqual(result, { userId: 'auth-user-1' });
});

test('createUser lanza ConflictError EMAIL_ALREADY_REGISTERED si Supabase Auth reporta email duplicado', async () => {
  const client = makeAuthClient({
    createUserResult: { data: null, error: { message: 'User already registered' } },
    signInResult: { data: {}, error: null },
  });
  const service = new SupabaseAuthIdentityService({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => service.createUser({ email: 'a@mani.test', password: 'x' }),
    (err) => {
      assert.equal(err.code, 'EMAIL_ALREADY_REGISTERED');
      assert.equal(err.statusCode, 409);
      return true;
    }
  );
});

test('createUser lanza DomainError INTERNAL_ERROR para otros errores de Supabase Auth', async () => {
  const client = makeAuthClient({
    createUserResult: { data: null, error: { message: 'service unavailable' } },
    signInResult: { data: {}, error: null },
  });
  const service = new SupabaseAuthIdentityService({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => service.createUser({ email: 'a@mani.test', password: 'x' }),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});

test('authenticate retorna los tokens de la sesión real', async () => {
  const client = makeAuthClient({
    createUserResult: { data: {}, error: null },
    signInResult: {
      data: { session: { access_token: 'at', refresh_token: 'rt', expires_in: 3600 } },
      error: null,
    },
  });
  const service = new SupabaseAuthIdentityService({ supabaseClientFactory: makeFakeClientFactory(client) });

  const tokens = await service.authenticate({ email: 'a@mani.test', password: 'Cambiar123!' });

  assert.deepEqual(tokens, { accessToken: 'at', refreshToken: 'rt', expiresIn: 3600 });
});

test('authenticate lanza DomainError INTERNAL_ERROR si el sign-in falla', async () => {
  const client = makeAuthClient({
    createUserResult: { data: {}, error: null },
    signInResult: { data: { session: null }, error: { message: 'invalid grant' } },
  });
  const service = new SupabaseAuthIdentityService({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => service.authenticate({ email: 'a@mani.test', password: 'x' }),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});
