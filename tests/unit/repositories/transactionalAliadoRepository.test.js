const test = require('node:test');
const assert = require('node:assert/strict');
const TransactionalAliadoRepository = require('../../../src/infrastructure/repositories/TransactionalAliadoRepository');
const { DomainError } = require('../../../src/domain/errors/DomainError');

const TENANT = '11111111-1111-4111-8111-111111111111';
const ALIADO = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';

/** Pool falso: registra cada consulta y responde con `response` (o lanza si es un Error). */
function makePool(response = { rows: [], rowCount: 0 }) {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
      if (response instanceof Error) throw response;
      return response;
    },
  };
  return { pool, calls };
}

function makeRepo(pool, delegate = {}) {
  return new TransactionalAliadoRepository({ pgPoolFactory: { getPool: () => pool }, delegate });
}

test('exige pgPoolFactory y delegate', () => {
  assert.throws(() => new TransactionalAliadoRepository({ delegate: {} }), /pgPoolFactory/);
  assert.throws(() => new TransactionalAliadoRepository({ pgPoolFactory: {} }), /delegate/);
});

test('updateVerificationStatus escribe verificado_por (CA-5) solo si sigue PENDIENTE en el tenant', async () => {
  const fecha = new Date('2026-10-25T10:00:00.000Z');
  const { pool, calls } = makePool({
    rowCount: 1,
    rows: [{ id: ALIADO, tenant_id: TENANT, estado_verificacion: 'VERIFICADO', verificado_por: ADMIN, fecha_verificacion: fecha }],
  });
  const repo = makeRepo(pool);

  const row = await repo.updateVerificationStatus(TENANT, ALIADO, {
    estadoVerificacion: 'VERIFIED',
    fechaVerificacion: fecha.toISOString(),
    verificadoPor: ADMIN,
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /^UPDATE aliado SET .*verificado_por = \$6/);
  assert.match(calls[0].sql, /WHERE tenant_id = \$1 AND id = \$2 AND estado_verificacion = 'PENDIENTE'/);
  assert.deepEqual(calls[0].params, [TENANT, ALIADO, 'VERIFICADO', null, fecha.toISOString(), ADMIN]);
  assert.equal(row.verificado_por, ADMIN);
  assert.equal(row.fecha_verificacion, fecha.toISOString(), 'las fechas salen como texto ISO, igual que supabase-js');
});

test('updateVerificationStatus devuelve null si ya fue resuelta (0 filas): el caso de uso responde 409', async () => {
  const { pool } = makePool({ rows: [], rowCount: 0 });
  const result = await makeRepo(pool).updateVerificationStatus(TENANT, ALIADO, {
    estadoVerificacion: 'REJECTED',
    motivoRechazo: 'Documento ilegible',
    verificadoPor: ADMIN,
  });
  assert.equal(result, null);
});

test('updateVerificationStatus no consulta con ids que no son UUID', async () => {
  const { pool, calls } = makePool();
  const result = await makeRepo(pool).updateVerificationStatus('tenant-x', ALIADO, { estadoVerificacion: 'VERIFIED' });
  assert.equal(result, null);
  assert.equal(calls.length, 0);
});

test('updateVerificationStatus rechaza un verificado_por que no es id de usuario', async () => {
  const { pool, calls } = makePool();
  await assert.rejects(
    makeRepo(pool).updateVerificationStatus(TENANT, ALIADO, { estadoVerificacion: 'VERIFIED', verificadoPor: 'admin-1' }),
    DomainError
  );
  assert.equal(calls.length, 0);
});

test('updateVerificationStatus traduce el error de PostgreSQL sin filtrar el detalle', async () => {
  const { pool } = makePool(Object.assign(new Error('relation "aliado" does not exist'), { code: '42P01' }));
  await assert.rejects(
    makeRepo(pool).updateVerificationStatus(TENANT, ALIADO, { estadoVerificacion: 'VERIFIED', verificadoPor: ADMIN }),
    (err) => err instanceof DomainError && err.statusCode === 500 && !/relation/.test(err.message)
  );
});

test('updateVerificationStatus falla explícito sin DATABASE_URL', async () => {
  const repo = new TransactionalAliadoRepository({ pgPoolFactory: { getPool: () => null }, delegate: {} });
  await assert.rejects(
    repo.updateVerificationStatus(TENANT, ALIADO, { estadoVerificacion: 'VERIFIED', verificadoPor: ADMIN }),
    /DATABASE_URL/
  );
});

test('las lecturas y el registro se delegan sin cambios al repositorio base', async () => {
  const seen = [];
  const delegate = {};
  for (const m of ['findByDocumentNumber', 'findByUsuarioId', 'create', 'deleteByUsuarioId', 'findById', 'findByTenant']) {
    delegate[m] = async (...args) => {
      seen.push([m, ...args]);
      return m;
    };
  }
  const repo = makeRepo(makePool().pool, delegate);

  assert.equal(await repo.findByDocumentNumber(TENANT, '123'), 'findByDocumentNumber');
  assert.equal(await repo.findByUsuarioId(TENANT, 'u'), 'findByUsuarioId');
  assert.equal(await repo.create({ id: 'a' }), 'create');
  assert.equal(await repo.deleteByUsuarioId(TENANT, 'u'), 'deleteByUsuarioId');
  assert.equal(await repo.findById(TENANT, ALIADO), 'findById');
  assert.equal(await repo.findByTenant(TENANT, { estadoVerificacion: 'PENDING' }), 'findByTenant');
  assert.deepEqual(seen[5], ['findByTenant', TENANT, { estadoVerificacion: 'PENDING' }]);
});
