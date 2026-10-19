const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { withTenantContext } = require('../../../src/infrastructure/db/withTenantContext');
const { DomainError } = require('../../../src/domain/errors/DomainError');

const TENANT_ID = '10000000-0000-4000-8000-000000000011';
const USER_ID = '30000000-0000-4000-8000-000000000012';

function createFakePool({ failOnQuery = null, failOnRollback = null } = {}) {
  const calls = [];
  const releasedWith = [];

  const client = {
    async query(sql, params) {
      calls.push({ sql, params });
      if (failOnQuery && sql.includes(failOnQuery)) {
        throw new Error(`Forced error on ${sql}`);
      }
      if (failOnRollback && sql === 'ROLLBACK') {
        throw failOnRollback;
      }
      return { rows: [], rowCount: 0 };
    },
    release(err) {
      releasedWith.push(err);
    },
  };

  return {
    calls,
    releasedWith,
    client,
    pool: {
      async connect() {
        return client;
      },
    },
  };
}

describe('SCRUM-1104 (CFG-23b): withTenantContext (ADR-0032 §6)', () => {
  it('abre transacción, fija app.set_context con rol en minúscula, ejecuta work, hace COMMIT y libera el cliente', async () => {
    const { pool, calls, releasedWith } = createFakePool();

    const output = await withTenantContext(
      pool,
      { tenantId: TENANT_ID, userId: USER_ID, role: 'ADMIN_TENANT' },
      async (client) => {
        await client.query('SELECT * FROM aliado');
        return 'ok-result';
      }
    );

    assert.equal(output, 'ok-result');
    assert.deepEqual(calls, [
      { sql: 'BEGIN', params: undefined },
      {
        sql: 'SELECT app.set_context($1, $2, $3)',
        params: [TENANT_ID, USER_ID, 'admin_tenant'],
      },
      { sql: 'SELECT * FROM aliado', params: undefined },
      { sql: 'COMMIT', params: undefined },
    ]);
    assert.deepEqual(releasedWith, [undefined]);
  });

  it('admite flujos pre-auth con userId = null y role = null por defecto', async () => {
    const { pool, calls } = createFakePool();

    await withTenantContext(pool, { tenantId: TENANT_ID }, async (client) => {
      await client.query('SELECT * FROM categoria_servicio');
    });

    assert.deepEqual(calls[1], {
      sql: 'SELECT app.set_context($1, $2, $3)',
      params: [TENANT_ID, null, null],
    });
  });

  it('hace ROLLBACK y libera el cliente si work lanza un error', async () => {
    const { pool, calls, releasedWith } = createFakePool();

    await assert.rejects(
      () =>
        withTenantContext(pool, { tenantId: TENANT_ID, userId: USER_ID, role: 'aliado' }, async () => {
          throw new DomainError('Fallo de negocio', 'BUSINESS_ERR', 422);
        }),
      (err) => err instanceof DomainError && err.code === 'BUSINESS_ERR'
    );

    assert.equal(calls[0].sql, 'BEGIN');
    assert.equal(calls[1].sql, 'SELECT app.set_context($1, $2, $3)');
    assert.equal(calls[2].sql, 'ROLLBACK');
    assert.deepEqual(releasedWith, [undefined]);
  });

  it('descarta la conexión del pool pasando releaseError si ROLLBACK también falla', async () => {
    const rollbackFailure = new Error('connection terminated unexpectedly');
    const { pool, releasedWith } = createFakePool({ failOnRollback: rollbackFailure });

    await assert.rejects(
      () =>
        withTenantContext(pool, { tenantId: TENANT_ID }, async () => {
          throw new Error('work failed');
        }),
      /work failed/
    );

    assert.deepEqual(releasedWith, [rollbackFailure]);
  });

  it('falla cerrado (MANI-RLS-400) si falta tenantId o no es un UUID válido', async () => {
    const { pool, calls } = createFakePool();

    await assert.rejects(
      () => withTenantContext(pool, {}, async () => {}),
      (err) => err instanceof DomainError && err.code === 'MANI-RLS-400' && err.statusCode === 400
    );

    await assert.rejects(
      () => withTenantContext(pool, { tenantId: 'no-es-un-uuid' }, async () => {}),
      (err) => err instanceof DomainError && err.code === 'MANI-RLS-400'
    );

    await assert.rejects(
      () => withTenantContext(pool, { tenantId: TENANT_ID, userId: 'bad-user-uuid' }, async () => {}),
      (err) => err instanceof DomainError && err.code === 'MANI-RLS-400'
    );

    assert.equal(calls.length, 0);
  });

  it('valida que pool y work estén definidos antes de conectar', async () => {
    const { pool } = createFakePool();

    await assert.rejects(
      () => withTenantContext(null, { tenantId: TENANT_ID }, async () => {}),
      (err) => err instanceof DomainError && err.code === 'INTERNAL_ERROR' && err.statusCode === 500
    );

    await assert.rejects(
      () => withTenantContext(pool, { tenantId: TENANT_ID }, null),
      /work debe ser una función/
    );
  });
});
