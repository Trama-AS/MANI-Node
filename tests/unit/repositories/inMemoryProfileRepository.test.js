const test = require('node:test');
const assert = require('node:assert/strict');
const InMemoryProfileRepository = require('../../../src/infrastructure/repositories/InMemoryProfileRepository');

test('findByUserId encuentra el perfil demo por id exacto', async () => {
  const repo = new InMemoryProfileRepository();

  const profile = await repo.findByUserId('demo-user-1');

  assert.equal(profile.fullName, 'Usuario Demo MANI');
});

test('findByUserId retorna null para un userId que no existe (B4: sin fallback al perfil demo)', async () => {
  const repo = new InMemoryProfileRepository();

  const profile = await repo.findByUserId('un-usuario-que-no-existe');

  assert.equal(profile, null);
});

test('findByUserId retorna null si el tenant no coincide, aunque el userId sí', async () => {
  const repo = new InMemoryProfileRepository();

  const profile = await repo.findByUserId('demo-user-1', 'otro-tenant');

  assert.equal(profile, null);
});
