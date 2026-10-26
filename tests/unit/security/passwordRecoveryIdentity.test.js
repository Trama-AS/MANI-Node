const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');
const SupabaseAuthIdentityService = require('../../../src/infrastructure/security/SupabaseAuthIdentityService');
const InMemoryAuthIdentityService = require('../../../src/infrastructure/security/InMemoryAuthIdentityService');
const { makeFakeClientFactory } = require('../../helpers/fakeSupabaseClient');

const TENANT = 'tenant-1';

// ---- Supabase ----

function supabaseService({ resetResult = { error: null }, getUserResult, updateResult = { error: null } } = {}) {
  const calls = { reset: [], getUser: [], update: [], disposable: [] };
  const admin = { updateUserById: async (...a) => (calls.update.push(a), updateResult) };
  const client = { auth: { admin, getUser: async (t) => (calls.getUser.push(t), getUserResult) } };
  const service = new SupabaseAuthIdentityService({
    supabaseClientFactory: makeFakeClientFactory(client),
    supabaseUrl: 'http://supabase.local',
    supabaseAnonKey: 'anon-key',
    createDisposableClient: (url, key, options) => {
      calls.disposable.push({ url, key, options });
      return { auth: { resetPasswordForEmail: async (...a) => (calls.reset.push(a), resetResult) } };
    },
  });
  return { service, calls };
}

test('supabase: requestPasswordRecovery usa un cliente descartable con anon key y el redirectTo', async () => {
  const { service, calls } = supabaseService();

  await service.requestPasswordRecovery({ email: 'a@mani.test', redirectTo: 'https://app/reset' });

  assert.equal(calls.disposable[0].key, 'anon-key');
  assert.equal(calls.disposable[0].options.auth.persistSession, false);
  assert.deepEqual(calls.reset[0], ['a@mani.test', { redirectTo: 'https://app/reset' }]);
});

test('supabase: sin redirectTo no manda opciones', async () => {
  const { service, calls } = supabaseService();
  await service.requestPasswordRecovery({ email: 'a@mani.test' });
  assert.deepEqual(calls.reset[0], ['a@mani.test', undefined]);
});

test('supabase: el límite de envíos del proveedor se informa como 429 RATE_LIMITED', async () => {
  for (const error of [{ status: 429, message: 'x' }, { code: 'over_email_send_rate_limit', message: 'email rate limit exceeded' }]) {
    const { service } = supabaseService({ resetResult: { error } });
    await assert.rejects(
      () => service.requestPasswordRecovery({ email: 'a@mani.test' }),
      (err) => err.statusCode === 429 && err.code === 'RATE_LIMITED'
    );
  }
});

test('supabase: otro error del proveedor es INTERNAL_ERROR sin filtrar su mensaje', async () => {
  const { service } = supabaseService({ resetResult: { error: { message: 'smtp host smtp.interno:25 refused' } } });
  await assert.rejects(
    () => service.requestPasswordRecovery({ email: 'a@mani.test' }),
    (err) => err.code === 'INTERNAL_ERROR' && !/smtp/.test(err.message)
  );
});

test('supabase: requestPasswordRecovery exige SUPABASE_ANON_KEY', async () => {
  const service = new SupabaseAuthIdentityService({ supabaseClientFactory: makeFakeClientFactory({}) });
  await assert.rejects(() => service.requestPasswordRecovery({ email: 'a@mani.test' }), /SUPABASE_ANON_KEY/);
});

const tokenWith = (claims) => jwt.sign(claims, 'cualquiera');

test('supabase: resolveRecoveryUser devuelve el dueño del token del enlace', async () => {
  const { service, calls } = supabaseService({ getUserResult: { data: { user: { id: 'u-1' } }, error: null } });
  const token = tokenWith({ sub: 'u-1', amr: [{ method: 'otp' }] });

  assert.deepEqual(await service.resolveRecoveryUser(token), { userId: 'u-1' });
  assert.deepEqual(calls.getUser, [token]);
});

test('supabase: un token vencido o desconocido para el proveedor es INVALID_RECOVERY_TOKEN (401)', async () => {
  const { service } = supabaseService({ getUserResult: { data: { user: null }, error: { message: 'invalid JWT' } } });
  await assert.rejects(
    () => service.resolveRecoveryUser(tokenWith({ sub: 'u-1' })),
    (err) => err.statusCode === 401 && err.code === 'INVALID_RECOVERY_TOKEN'
  );
});

test('supabase: una sesión normal (inicio con contraseña) no sirve para restablecer la contraseña', async () => {
  const { service } = supabaseService({ getUserResult: { data: { user: { id: 'u-1' } }, error: null } });
  await assert.rejects(
    () => service.resolveRecoveryUser(tokenWith({ sub: 'u-1', amr: [{ method: 'password' }] })),
    (err) => err.code === 'INVALID_RECOVERY_TOKEN'
  );
});

test('supabase: updatePassword usa la API de administración con el id', async () => {
  const { service, calls } = supabaseService();
  await service.updatePassword('u-1', 'NuevaClave123');
  assert.deepEqual(calls.update[0], ['u-1', { password: 'NuevaClave123' }]);
});

test('supabase: updatePassword distingue contraseña débil de falla interna', async () => {
  const weak = supabaseService({ updateResult: { error: { code: 'weak_password', message: 'Password should be longer' } } });
  await assert.rejects(() => weak.service.updatePassword('u-1', 'x'), (err) => err.statusCode === 400 && err.code === 'WEAK_PASSWORD');

  const down = supabaseService({ updateResult: { error: { message: 'connection reset' } } });
  await assert.rejects(() => down.service.updatePassword('u-1', 'x'), (err) => err.statusCode === 500);
});

// ---- En memoria (DEV/test) ----

async function memoryService() {
  const service = new InMemoryAuthIdentityService({ jwtSecret: 'dev-jwt-secret-insecure-32chars!!' });
  const { userId } = await service.createUser({ tenantId: TENANT, email: 'Ana@Mani.test', password: 'ClaveVieja123', role: 'CLIENT' });
  return { service, userId };
}

test('en memoria: el flujo completo cambia la contraseña y el enlace sirve una sola vez', async () => {
  const { service, userId } = await memoryService();

  await service.requestPasswordRecovery({ email: 'ana@mani.test', redirectTo: 'https://app/reset' });
  const [{ token, redirectTo }] = service.sentRecoveries;
  assert.equal(redirectTo, 'https://app/reset');

  assert.deepEqual(await service.resolveRecoveryUser(token), { userId });
  await service.updatePassword(userId, 'ClaveNueva123');

  await assert.rejects(() => service.authenticate({ tenantId: TENANT, email: 'ana@mani.test', password: 'ClaveVieja123' }), /Credenciales/);
  const session = await service.authenticate({ tenantId: TENANT, email: 'ana@mani.test', password: 'ClaveNueva123' });
  assert.ok(session.accessToken);
  await assert.rejects(() => service.resolveRecoveryUser(token), (err) => err.code === 'INVALID_RECOVERY_TOKEN');
});

test('en memoria: un correo sin cuenta no envía nada ni falla', async () => {
  const { service } = await memoryService();
  await service.requestPasswordRecovery({ email: 'nadie@mani.test' });
  assert.deepEqual(service.sentRecoveries, []);
});

test('en memoria: un token inventado o vencido es INVALID_RECOVERY_TOKEN', async () => {
  const { service, userId } = await memoryService();
  await assert.rejects(() => service.resolveRecoveryUser('inventado'), (err) => err.statusCode === 401);

  await service.requestPasswordRecovery({ email: 'ana@mani.test' });
  const [{ token }] = service.sentRecoveries;
  service.recoveryTokens.get(token).expiresAt = Date.now() - 1;
  await assert.rejects(() => service.resolveRecoveryUser(token), (err) => err.code === 'INVALID_RECOVERY_TOKEN');
  assert.ok(userId);
});
