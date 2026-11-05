const test = require('node:test');
const assert = require('node:assert/strict');
const PgAliadoRepository = require('../../../src/infrastructure/repositories/PgAliadoRepository');
const { DomainError } = require('../../../src/domain/errors/DomainError');
const { ejecutarComo } = require('../../../src/application/context/contextoIdentidad');

const TENANT = '11111111-1111-4111-8111-111111111111';
const OTRO_TENANT = '44444444-4444-4444-8444-444444444444';
const ALIADO = '22222222-2222-4222-8222-222222222222';
const ADMIN = '33333333-3333-4333-8333-333333333333';

/**
 * Pool falso con transacciones: registra cada consulta del cliente y responde a la de datos con `response` (o lanza
 * si es un Error). BEGIN, set_context, COMMIT y ROLLBACK responden vacío.
 */
function makePool(response = { rows: [], rowCount: 0 }) {
  const calls = [];
  const client = {
    async query(sql, params) {
      const limpio = sql.replace(/\s+/g, ' ').trim();
      calls.push({ sql: limpio, params });
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(limpio) || /app\.set_context/.test(limpio)) return { rows: [], rowCount: 0 };
      if (response instanceof Error) throw response;
      return response;
    },
    release() {},
  };
  return { pool: { connect: async () => client }, calls };
}

function makeRepo(pool) {
  return new PgAliadoRepository({ pgPoolFactory: { getPool: () => pool } });
}

const datos = (calls) => calls.filter((c) => !/^(BEGIN|COMMIT|ROLLBACK)$/.test(c.sql) && !/set_context/.test(c.sql));

test('exige pgPoolFactory', () => {
  assert.throws(() => new PgAliadoRepository({}), /pgPoolFactory/);
});

test('SCRUM-1468: la resolución corre en la transacción del tenant, después de app.set_context', async () => {
  // Con TransactionalAliadoRepository el UPDATE iba por pool.query sin contexto: con mani_core_svc (sin BYPASSRLS)
  // la política aliado_tenant no dejaba ver la fila y toda aprobación respondía 409.
  const { pool, calls } = makePool({ rowCount: 1, rows: [{ id: ALIADO, tenant_id: TENANT }] });
  await ejecutarComo({ tenantId: TENANT, userId: ADMIN, role: 'ADMIN' }, () =>
    makeRepo(pool).updateVerificationStatus(TENANT, ALIADO, { estadoVerificacion: 'VERIFIED', verificadoPor: ADMIN })
  );

  assert.deepEqual(
    calls.map((c) => c.sql.split(' ')[0]),
    ['BEGIN', 'SELECT', 'UPDATE', 'COMMIT'],
    'BEGIN, set_context, UPDATE y COMMIT en el mismo cliente'
  );
  assert.deepEqual(calls[1].params, [TENANT, ADMIN, 'admin_tenant'], 'el contexto lleva el tenant, el admin y su rol');
});

test('updateVerificationStatus escribe verificado_por (CA-5) solo si sigue PENDIENTE en el tenant', async () => {
  const fecha = new Date('2026-10-25T10:00:00.000Z');
  const { pool, calls } = makePool({
    rowCount: 1,
    rows: [{ id: ALIADO, tenant_id: TENANT, estado_verificacion: 'VERIFICADO', verificado_por: ADMIN, fecha_verificacion: fecha }],
  });

  const row = await makeRepo(pool).updateVerificationStatus(TENANT, ALIADO, {
    estadoVerificacion: 'VERIFIED',
    fechaVerificacion: fecha.toISOString(),
    verificadoPor: ADMIN,
  });

  const [update] = datos(calls);
  assert.match(update.sql, /^UPDATE aliado SET .*verificado_por = \$6/);
  assert.match(update.sql, /WHERE tenant_id = \$1 AND id = \$2 AND estado_verificacion = 'PENDIENTE'/);
  assert.deepEqual(update.params, [TENANT, ALIADO, 'VERIFICADO', null, fecha.toISOString(), ADMIN]);
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

test('un error de PostgreSQL se traduce sin filtrar el detalle y la transacción se revierte', async () => {
  const { pool, calls } = makePool(Object.assign(new Error('relation "aliado" does not exist'), { code: '42P01' }));
  await assert.rejects(
    makeRepo(pool).updateVerificationStatus(TENANT, ALIADO, { estadoVerificacion: 'VERIFIED', verificadoPor: ADMIN }),
    (err) => err instanceof DomainError && err.statusCode === 500 && !/relation/.test(err.message) && Boolean(err.cause)
  );
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
});

test('sin DATABASE_URL falla con 503 en lugar de inventar datos', async () => {
  const repo = new PgAliadoRepository({ pgPoolFactory: { getPool: () => null } });
  await assert.rejects(repo.findById(TENANT, ALIADO), (err) => err.statusCode === 503);
});

test('el contexto toma usuario y rol de la identidad solo si es del mismo tenant', async () => {
  const { pool, calls } = makePool({ rows: [], rowCount: 0 });
  await ejecutarComo({ tenantId: OTRO_TENANT, userId: ADMIN, role: 'ADMIN' }, () => makeRepo(pool).findById(TENANT, ALIADO));
  const contexto = calls.find((c) => /set_context/.test(c.sql));
  assert.deepEqual(contexto.params, [TENANT, null, null], 'una identidad de otro tenant no presta su usuario ni su rol');
});

test('findByTenant filtra por estado de verificación traducido al de la base', async () => {
  const { pool, calls } = makePool({ rows: [{ id: ALIADO, created_at: new Date('2026-01-01T00:00:00Z') }], rowCount: 1 });
  const filas = await makeRepo(pool).findByTenant(TENANT, { estadoVerificacion: 'PENDING' });
  assert.deepEqual(datos(calls)[0].params, [TENANT, 'PENDIENTE']);
  assert.equal(filas[0].created_at, '2026-01-01T00:00:00.000Z');
});

test('findByUsuarioId sin tenant no consulta: con RLS no habría fila visible', async () => {
  const { pool, calls } = makePool();
  assert.equal(await makeRepo(pool).findByUsuarioId(null, ADMIN), null);
  assert.equal(calls.length, 0);
});
