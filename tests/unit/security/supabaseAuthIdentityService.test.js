const test = require('node:test');
const assert = require('node:assert/strict');
const SupabaseAuthIdentityService = require('../../../src/infrastructure/security/SupabaseAuthIdentityService');
const { makeFakeClientFactory } = require('../../helpers/fakeSupabaseClient');

function makeAdminClient({ createUserResult }) {
  return { auth: { admin: { createUser: async () => createUserResult } } };
}

function makeDisposableClientFactory(signInResult) {
  const calls = [];
  const createDisposableClient = (url, anonKey, options) => {
    calls.push({ url, anonKey, options });
    return { auth: { signInWithPassword: async () => signInResult } };
  };
  return { createDisposableClient, calls };
}

test('createUser crea la cuenta en Supabase Auth y retorna solo el userId (sin iniciar sesión)', async () => {
  const client = makeAdminClient({ createUserResult: { data: { user: { id: 'auth-user-1' } }, error: null } });
  const service = new SupabaseAuthIdentityService({ supabaseClientFactory: makeFakeClientFactory(client) });

  const result = await service.createUser({ email: 'a@mani.test', password: 'Cambiar123!' });

  assert.deepEqual(result, { userId: 'auth-user-1' });
});

test('createUser lanza ConflictError EMAIL_ALREADY_REGISTERED si Supabase Auth reporta email duplicado', async () => {
  const client = makeAdminClient({ createUserResult: { data: null, error: { message: 'User already registered' } } });
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
  const client = makeAdminClient({ createUserResult: { data: null, error: { message: 'service unavailable' } } });
  const service = new SupabaseAuthIdentityService({ supabaseClientFactory: makeFakeClientFactory(client) });

  await assert.rejects(
    () => service.createUser({ email: 'a@mani.test', password: 'x' }),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});

test('authenticate usa un cliente DESCARTABLE (anon key), no el singleton de service-role (B2)', async () => {
  const { createDisposableClient, calls } = makeDisposableClientFactory({
    data: { session: { access_token: 'at', refresh_token: 'rt', expires_in: 3600 } },
    error: null,
  });
  // El cliente de service-role no debe tener auth.signInWithPassword invocado nunca.
  let serviceRoleSignInCalled = false;
  const serviceRoleClient = {
    auth: { signInWithPassword: async () => { serviceRoleSignInCalled = true; } },
  };
  const service = new SupabaseAuthIdentityService({
    supabaseClientFactory: makeFakeClientFactory(serviceRoleClient),
    supabaseUrl: 'https://proyecto.supabase.co',
    supabaseAnonKey: 'anon-key-123',
    createDisposableClient,
  });

  const tokens = await service.authenticate({ email: 'a@mani.test', password: 'Cambiar123!' });

  assert.deepEqual(tokens, { accessToken: 'at', refreshToken: 'rt', expiresIn: 3600 });
  assert.equal(serviceRoleSignInCalled, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://proyecto.supabase.co');
  assert.equal(calls[0].anonKey, 'anon-key-123');
  assert.equal(calls[0].options.auth.persistSession, false);
});

test('authenticate crea un cliente nuevo en cada llamada (no reutiliza sesión entre aliados distintos)', async () => {
  const { createDisposableClient, calls } = makeDisposableClientFactory({
    data: { session: { access_token: 'at', refresh_token: 'rt', expires_in: 3600 } },
    error: null,
  });
  const service = new SupabaseAuthIdentityService({
    supabaseClientFactory: makeFakeClientFactory({}),
    supabaseUrl: 'https://proyecto.supabase.co',
    supabaseAnonKey: 'anon-key-123',
    createDisposableClient,
  });

  await service.authenticate({ email: 'primero@mani.test', password: 'x' });
  await service.authenticate({ email: 'segundo@mani.test', password: 'y' });

  assert.equal(calls.length, 2);
});

test('authenticate lanza DomainError INTERNAL_ERROR si el sign-in falla', async () => {
  const { createDisposableClient } = makeDisposableClientFactory({
    data: { session: null },
    error: { message: 'invalid grant' },
  });
  const service = new SupabaseAuthIdentityService({
    supabaseClientFactory: makeFakeClientFactory({}),
    supabaseUrl: 'https://proyecto.supabase.co',
    supabaseAnonKey: 'anon-key-123',
    createDisposableClient,
  });

  await assert.rejects(
    () => service.authenticate({ email: 'a@mani.test', password: 'x' }),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});

test('authenticate lanza DomainError INTERNAL_ERROR si falta SUPABASE_ANON_KEY', async () => {
  const service = new SupabaseAuthIdentityService({
    supabaseClientFactory: makeFakeClientFactory({}),
    supabaseUrl: 'https://proyecto.supabase.co',
    supabaseAnonKey: undefined,
  });

  await assert.rejects(
    () => service.authenticate({ email: 'a@mani.test', password: 'x' }),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      return true;
    }
  );
});
