const test = require('node:test');
const assert = require('node:assert/strict');
const PgAliadoCategoriaRepository = require('../../../src/infrastructure/repositories/PgAliadoCategoriaRepository');

const TENANT = '11111111-1111-4111-8111-111111111111';
const ALIADO = '22222222-2222-4222-8222-222222222222';
const CAT_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CAT_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/**
 * Pool falso: registra cada consulta en orden y responde según un guion.
 * `script` mapea un fragmento del SQL a la respuesta (o a un Error para simular un fallo).
 */
function makePool(script = {}) {
  const calls = [];
  const contexts = [];
  const released = [];
  const client = {
    async query(sql, params) {
      const text = sql.replace(/\s+/g, ' ').trim();
      // SELECT app.set_context(tenant, usuario, rol) lo emite runInTenantContext (ADR-0032) y se registra aparte.
      if (text.startsWith('SELECT app.set_context')) {
        contexts.push(params);
        return { rows: [], rowCount: 0 };
      }
      calls.push({ sql: text, params });
      for (const [fragment, response] of Object.entries(script)) {
        if (text.includes(fragment)) {
          if (response instanceof Error) throw response;
          return typeof response === 'function' ? response(params) : response;
        }
      }
      return { rows: [], rowCount: 0 };
    },
    release(err) {
      released.push(err || null);
    },
  };
  return { pool: { connect: async () => client }, calls, contexts, released };
}

function makeRepo(pool) {
  return new PgAliadoCategoriaRepository({ pgPoolFactory: { getPool: () => pool } });
}

const happyScript = (finalIds) => ({
  'FOR UPDATE OF a': { rows: [{ id: ALIADO }], rowCount: 1 },
  'count(*)': (params) => ({ rows: [{ total: params[0].length }] }),
  'SELECT categoria_id': { rows: finalIds.map((categoria_id) => ({ categoria_id })) },
});

test('reemplaza el conjunto dentro de una transacción: BEGIN, bloqueo, validación, delete, insert, COMMIT', async () => {
  const { pool, calls, contexts, released } = makePool(happyScript([CAT_A, CAT_B]));
  const repo = makeRepo(pool);
  const USUARIO = '33333333-3333-4333-8333-333333333333';

  const result = await repo.setAliadoCategorias(TENANT, ALIADO, [CAT_A, CAT_B], { userId: USUARIO, role: 'ALLY' });

  // El guardado corre con el tenant, el usuario y el rol del JWT (rol en vocabulario del claim).
  assert.deepEqual(contexts, [[TENANT, USUARIO, 'aliado']]);

  assert.deepEqual(result, [CAT_A, CAT_B]);
  const verbs = calls.map((c) => c.sql.split(' ')[0]);
  assert.deepEqual(verbs, ['BEGIN', 'SELECT', 'SELECT', 'DELETE', 'INSERT', 'SELECT', 'COMMIT']);
  assert.match(calls[1].sql, /FOR UPDATE OF a/);
  assert.match(calls[1].sql, /u\.estado = 'ACTIVO' AND u\.rol = 'ALIADO'/);
  assert.deepEqual(released, [null]);
});

test('toda consulta de datos va acotada al tenant (no se confía en el aliado solo)', async () => {
  const { pool, calls } = makePool(happyScript([CAT_A]));
  await makeRepo(pool).setAliadoCategorias(TENANT, ALIADO, [CAT_A]);

  for (const c of calls.filter((q) => !['BEGIN', 'COMMIT', 'ROLLBACK'].includes(q.sql))) {
    assert.ok(c.params.includes(TENANT), `la consulta no recibe el tenant: ${c.sql}`);
    assert.match(c.sql, /tenant_id/);
  }
});

test('deduplica los ids antes de validar y de escribir', async () => {
  const { pool, calls } = makePool(happyScript([CAT_A]));
  await makeRepo(pool).setAliadoCategorias(TENANT, ALIADO, [CAT_A, CAT_A, CAT_A]);

  const count = calls.find((c) => c.sql.includes('count(*)'));
  assert.deepEqual(count.params[0], [CAT_A]);
});

test('un aliado inactivo, de otro tenant o sin rol ALIADO responde MANI-CAT-403 y hace ROLLBACK', async () => {
  const { pool, calls, released } = makePool({ 'FOR UPDATE OF a': { rows: [], rowCount: 0 } });

  await assert.rejects(
    () => makeRepo(pool).setAliadoCategorias(TENANT, ALIADO, [CAT_A]),
    (err) => {
      assert.equal(err.code, 'MANI-CAT-403');
      assert.equal(err.statusCode, 403);
      return true;
    }
  );
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  assert.ok(!calls.some((c) => c.sql.startsWith('DELETE') || c.sql.startsWith('INSERT')));
  assert.deepEqual(released, [null]);
});

test('una categoría inactiva, inexistente o de otro tenant responde MANI-CAT-422C sin tocar los datos', async () => {
  const { pool, calls } = makePool({
    'FOR UPDATE OF a': { rows: [{ id: ALIADO }], rowCount: 1 },
    'count(*)': { rows: [{ total: 1 }] }, // piden 2, solo 1 es válida
  });

  await assert.rejects(
    () => makeRepo(pool).setAliadoCategorias(TENANT, ALIADO, [CAT_A, CAT_B]),
    (err) => {
      assert.equal(err.code, 'MANI-CAT-422C');
      assert.equal(err.statusCode, 422);
      return true;
    }
  );
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
  assert.ok(!calls.some((c) => c.sql.startsWith('DELETE')), 'no debe borrar nada si la validación falla');
});

test('si el INSERT falla se hace ROLLBACK y el aliado conserva su conjunto anterior', async () => {
  const boom = Object.assign(new Error('connection reset'), { code: '08006' });
  const { pool, calls, released } = makePool({
    ...happyScript([CAT_A]),
    'INSERT INTO aliado_categoria': boom,
  });

  await assert.rejects(
    () => makeRepo(pool).setAliadoCategorias(TENANT, ALIADO, [CAT_A]),
    (err) => {
      assert.equal(err.code, 'INTERNAL_ERROR');
      assert.equal(err.statusCode, 500);
      assert.doesNotMatch(err.message, /connection reset/, 'no debe filtrar el detalle interno');
      assert.equal(err.cause, boom);
      return true;
    }
  );
  const verbs = calls.map((c) => c.sql.split(' ')[0]);
  assert.ok(verbs.includes('DELETE'), 'el DELETE ocurrió dentro de la transacción');
  assert.equal(verbs.at(-1), 'ROLLBACK');
  assert.ok(!verbs.includes('COMMIT'));
  assert.deepEqual(released, [null]);
});

test('el trigger de tenant (P0001 MANI-CAT-422C) y la FK (23503) se traducen a 422C', async () => {
  for (const pgError of [
    Object.assign(new Error('MANI-CAT-422C: el aliado y la categoría deben pertenecer al mismo tenant'), { code: 'P0001' }),
    Object.assign(new Error('violates foreign key constraint'), { code: '23503' }),
  ]) {
    const { pool } = makePool({ ...happyScript([CAT_A]), 'INSERT INTO aliado_categoria': pgError });
    await assert.rejects(
      () => makeRepo(pool).setAliadoCategorias(TENANT, ALIADO, [CAT_A]),
      (err) => err.code === 'MANI-CAT-422C' && err.statusCode === 422
    );
  }
});

test('si el ROLLBACK también falla, la conexión se descarta del pool en lugar de reutilizarse', async () => {
  const rollbackFailure = new Error('rollback roto');
  const { pool, released } = makePool({
    'FOR UPDATE OF a': Object.assign(new Error('x'), { code: '57014' }),
    ROLLBACK: rollbackFailure,
  });

  await assert.rejects(() => makeRepo(pool).setAliadoCategorias(TENANT, ALIADO, [CAT_A]), /Error guardando/);
  assert.deepEqual(released, [rollbackFailure]);
});

test('valida antes de abrir una conexión: lista vacía y valores que no son UUID', async () => {
  let connected = 0;
  const repo = makeRepo({ connect: async () => { connected += 1; } });

  await assert.rejects(() => repo.setAliadoCategorias(TENANT, ALIADO, []), (e) => e.code === 'MANI-CAT-422V');
  await assert.rejects(() => repo.setAliadoCategorias(TENANT, ALIADO, ['no-es-uuid']), (e) => e.code === 'MANI-CAT-422C');
  await assert.rejects(() => repo.setAliadoCategorias(TENANT, "x'; DROP TABLE aliado;--", [CAT_A]), (e) => e.code === 'MANI-CAT-403');
  assert.equal(connected, 0);
});

test('sin DATABASE_URL configurada falla con un error interno claro', async () => {
  const repo = new PgAliadoCategoriaRepository({ pgPoolFactory: { getPool: () => null } });
  await assert.rejects(() => repo.setAliadoCategorias(TENANT, ALIADO, [CAT_A]), /DATABASE_URL/);
});

test('SCRUM-1468: create, findByAliadoId y deleteByAliadoId corren con app.set_context del tenant', async () => {
  const { pool, calls, contexts } = makePool({
    'INSERT INTO aliado_categoria': { rows: [{ tenant_id: TENANT, aliado_id: ALIADO, categoria_id: CAT_A }], rowCount: 1 },
    'SELECT categoria_id': { rows: [{ categoria_id: CAT_A }], rowCount: 1 },
  });
  const repo = makeRepo(pool);

  assert.equal((await repo.create({ tenantId: TENANT, aliadoId: ALIADO, categoriaId: CAT_A })).categoria_id, CAT_A);
  assert.deepEqual(await repo.findByAliadoId(TENANT, ALIADO), [CAT_A]);
  await repo.deleteByAliadoId(TENANT, ALIADO);

  // Antes iban por supabase-js con service_role, sin RLS; ahora cada una abre su transacción con el tenant.
  assert.deepEqual(contexts, [[TENANT, null, null], [TENANT, null, null], [TENANT, null, null]]);
  for (const c of calls.filter((q) => !['BEGIN', 'COMMIT'].includes(q.sql))) {
    assert.ok(c.params.includes(TENANT), `la consulta no recibe el tenant: ${c.sql}`);
  }
});

test('findByAliadoId sin tenant devuelve vacío sin abrir conexión', async () => {
  let conexiones = 0;
  const repo = makeRepo({ connect: async () => { conexiones += 1; } });
  assert.deepEqual(await repo.findByAliadoId(null, ALIADO), []);
  assert.equal(conexiones, 0);
});

test('el constructor exige sus dependencias', () => {
  assert.throws(() => new PgAliadoCategoriaRepository({}), /pgPoolFactory/);
});
