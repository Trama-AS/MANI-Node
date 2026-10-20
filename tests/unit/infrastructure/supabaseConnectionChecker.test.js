const test = require('node:test');
const assert = require('node:assert/strict');
const SupabaseConnectionChecker = require('../../../src/infrastructure/db/SupabaseConnectionChecker');

function fakeFactory({ configured, listUsersResult, listUsersError }) {
  return {
    isConfigured: () => configured,
    getClient: () => ({
      auth: {
        admin: {
          listUsers: async () => {
            if (listUsersError) throw listUsersError;
            return listUsersResult;
          },
        },
      },
    }),
  };
}

test('reporta configured:false cuando no hay credenciales de Supabase', async () => {
  const checker = new SupabaseConnectionChecker({
    supabaseClientFactory: fakeFactory({ configured: false }),
  });

  const result = await checker.check();

  assert.deepEqual(result, { configured: false, connected: false });
});

test('reporta connected:true cuando listUsers responde sin error (service-role válido)', async () => {
  const checker = new SupabaseConnectionChecker({
    supabaseClientFactory: fakeFactory({
      configured: true,
      listUsersResult: { data: { users: [] }, error: null },
    }),
  });

  const result = await checker.check();

  assert.equal(result.configured, true);
  assert.equal(result.connected, true);
  assert.ok(typeof result.latencyMs === 'number');
});

test('reporta connected:false y el motivo cuando Supabase devuelve error', async () => {
  const checker = new SupabaseConnectionChecker({
    supabaseClientFactory: fakeFactory({
      configured: true,
      listUsersResult: { data: null, error: { message: 'Invalid API key' } },
    }),
  });

  const result = await checker.check();

  assert.equal(result.configured, true);
  assert.equal(result.connected, false);
  assert.equal(result.error, 'Invalid API key');
});

test('reporta connected:false cuando la llamada lanza una excepción de red', async () => {
  const checker = new SupabaseConnectionChecker({
    supabaseClientFactory: fakeFactory({
      configured: true,
      listUsersError: new Error('fetch failed'),
    }),
  });

  const result = await checker.check();

  assert.equal(result.configured, true);
  assert.equal(result.connected, false);
  assert.equal(result.error, 'fetch failed');
});
