const test = require('node:test');
const assert = require('node:assert/strict');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');

const URL = 'postgres://usuario:clave@localhost:5432/base';

test('sin configuración usa los valores por omisión: 5 conexiones, 10 s de espera y 30 s de inactividad (SCRUM-1651)', async () => {
  const fabrica = new PgPoolFactory({ databaseUrl: URL });
  const pool = fabrica.getPool();
  try {
    assert.equal(pool.options.max, 5);
    assert.equal(pool.options.connectionTimeoutMillis, 10000);
    assert.equal(pool.options.idleTimeoutMillis, 30000);
  } finally {
    await fabrica.close();
  }
});

test('el pool recibe el tamaño y las esperas configuradas (SCRUM-1651)', async () => {
  const fabrica = new PgPoolFactory({ databaseUrl: URL, max: 12, connectionTimeoutMs: 4000, idleTimeoutMs: 15000 });
  const pool = fabrica.getPool();
  try {
    assert.equal(pool.options.max, 12);
    assert.equal(pool.options.connectionTimeoutMillis, 4000);
    assert.equal(pool.options.idleTimeoutMillis, 15000);
  } finally {
    await fabrica.close();
  }
});

test('el pool se memoiza y sin DATABASE_URL no se crea ninguno', async () => {
  assert.equal(new PgPoolFactory({}).getPool(), null);
  const fabrica = new PgPoolFactory({ databaseUrl: URL });
  try {
    assert.equal(fabrica.getPool(), fabrica.getPool());
  } finally {
    await fabrica.close();
  }
});
