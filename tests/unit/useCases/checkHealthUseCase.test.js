const test = require('node:test');
const assert = require('node:assert/strict');
const CheckHealthUseCase = require('../../../src/application/useCases/health/CheckHealthUseCase');

function fakeChecker(result) {
  return { check: async () => result };
}

test('status UP cuando Supabase no está configurado', async () => {
  const useCase = new CheckHealthUseCase({
    supabaseConnectionChecker: fakeChecker({ configured: false, connected: false }),
    envLabel: 'DEV',
  });

  const result = await useCase.execute();

  assert.equal(result.status, 'UP');
  assert.equal(result.environment, 'DEV');
  assert.equal(result.database.configured, false);
});

test('status UP cuando Supabase está configurado y conecta', async () => {
  const useCase = new CheckHealthUseCase({
    supabaseConnectionChecker: fakeChecker({ configured: true, connected: true, latencyMs: 12 }),
    envLabel: 'QA',
  });

  const result = await useCase.execute();

  assert.equal(result.status, 'UP');
  assert.equal(result.database.connected, true);
});

test('status DEGRADED cuando Supabase está configurado pero no conecta', async () => {
  const useCase = new CheckHealthUseCase({
    supabaseConnectionChecker: fakeChecker({
      configured: true,
      connected: false,
      error: 'Invalid API key',
    }),
    envLabel: 'QA',
  });

  const result = await useCase.execute();

  assert.equal(result.status, 'DEGRADED');
  assert.equal(result.database.error, 'Invalid API key');
});
