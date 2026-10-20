const test = require('node:test');
const assert = require('node:assert/strict');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');

test('sin DATABASE_URL no está configurada y no crea pool', () => {
  const factory = new PgPoolFactory({});
  assert.equal(factory.isConfigured(), false);
  assert.equal(factory.getPool(), null);
});

test('con DATABASE_URL memoiza un único pool y registra el manejador de errores', async () => {
  const factory = new PgPoolFactory({ databaseUrl: 'postgresql://u:p@127.0.0.1:1/db' });
  assert.equal(factory.isConfigured(), true);

  const pool = factory.getPool();
  assert.equal(factory.getPool(), pool);
  assert.ok(pool.listenerCount('error') >= 1, 'un cliente inactivo que falla no debe tumbar el proceso');

  await factory.close();
  assert.equal(factory.pool, null);
});
