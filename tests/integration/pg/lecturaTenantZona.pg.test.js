// SCRUM-1720 (ADR-0032): con la llave `anon` no se listan `tenant` ni `zona`; Core, Dispatch y `authenticated` sí leen.
// Se omite sin TEST_DATABASE_URL; en CI corre siempre. Preparación local: la de seguimientoSolicitud.pg.test.js.
//
// Cada prueba corre en UNA transacción que termina en ROLLBACK: cambia políticas y permisos de tablas compartidas, y los
// archivos pg corren en paralelo sobre la misma base; así ninguna otra conexión ve este estado ni se bloquea por él.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };
const uuid = () => crypto.randomUUID();

const MIGRACION = fs.readFileSync(path.join(__dirname, '../../../db/migrations/0044_retirar_lectura_publica_tenant_zona.sql'), 'utf8');

/** Corre `fn(client)` dentro de una transacción que siempre se deshace. */
async function enTransaccion(t, fn) {
  const fabrica = new PgPoolFactory({ databaseUrl: url });
  t.after(() => fabrica.close());
  const client = await fabrica.getPool().connect();
  try {
    await client.query('BEGIN');
    await fn(client);
  } finally {
    await client.query('ROLLBACK').catch(() => {});
    client.release();
  }
}

/** Cuenta filas de `tabla` como `rol`; devuelve el error de PostgreSQL si lo hay. El savepoint deshace el SET ROLE. */
async function leerComo(client, rol, tabla) {
  await client.query('SAVEPOINT lectura');
  try {
    await client.query(`SET LOCAL ROLE ${rol}`);
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${tabla}`);
    return { n: rows[0].n };
  } catch (err) {
    return { error: err };
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT lectura');
  }
}

/** Una fila propia en cada tabla, para que haya algo que listar. */
async function sembrar(client) {
  const tenant = uuid();
  const zona = uuid();
  await client.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T1720', $2, 'ACTIVO')", [tenant, `t1720-${tenant}`]);
  await client.query("INSERT INTO zona (id, nivel, nombre, zona_padre_id, estado) VALUES ($1, 'LOCALIDAD', 'Z1720', NULL, 'ACTIVO')", [zona]);
  return { tenant, zona };
}

/** Deja la base como estaba en QA antes de la 0044: las dos políticas creadas a mano y `anon` con lectura. */
async function estadoDeQa(client) {
  await client.query(`
    DROP POLICY IF EXISTS lectura_global_tenant ON tenant;
    DROP POLICY IF EXISTS lectura_global_zona ON zona;
    CREATE POLICY lectura_global_tenant ON tenant FOR SELECT TO public USING (true);
    CREATE POLICY lectura_global_zona ON zona FOR SELECT TO public USING (true);
    DROP POLICY IF EXISTS tenant_lectura ON tenant;
    DROP POLICY IF EXISTS zona_lectura ON zona;
    CREATE POLICY tenant_lectura ON tenant FOR SELECT TO anon, authenticated, mani_core_svc, mani_dispatch_svc USING (true);
    CREATE POLICY zona_lectura ON zona FOR SELECT TO anon, authenticated, mani_core_svc, mani_dispatch_svc USING (true);
    GRANT SELECT ON tenant, zona TO anon;
  `);
}

test('SCRUM-1720: antes de la 0044 anon lista tenant y zona; después recibe permission denied', opts, async (t) => {
  await enTransaccion(t, async (client) => {
    await sembrar(client);
    await estadoDeQa(client);

    // Estado de QA: la llave anon lista todo.
    assert.ok((await leerComo(client, 'anon', 'tenant')).n > 0, 'sin la 0044, anon debería poder listar tenant');
    assert.ok((await leerComo(client, 'anon', 'zona')).n > 0, 'sin la 0044, anon debería poder listar zona');

    await client.query(MIGRACION);

    assert.equal((await leerComo(client, 'anon', 'tenant')).error?.code, '42501');
    assert.equal((await leerComo(client, 'anon', 'zona')).error?.code, '42501');
  });
});

test('SCRUM-1720: Core, Dispatch y authenticated siguen leyendo tenant y zona', opts, async (t) => {
  await enTransaccion(t, async (client) => {
    await sembrar(client);
    await estadoDeQa(client);
    await client.query(MIGRACION);

    for (const rol of ['mani_core_svc', 'mani_dispatch_svc', 'authenticated']) {
      assert.ok((await leerComo(client, rol, 'tenant')).n > 0, `${rol} debe leer tenant`);
      assert.ok((await leerComo(client, rol, 'zona')).n > 0, `${rol} debe leer zona`);
    }
  });
});

test('SCRUM-1720: no queda ninguna política de lectura abierta a public o anon en tenant ni zona', opts, async (t) => {
  await enTransaccion(t, async (client) => {
    await estadoDeQa(client);
    await client.query(MIGRACION);

    const abiertas = await client.query(
      `SELECT tablename, policyname, roles::text AS roles
         FROM pg_policies
        WHERE schemaname = 'public' AND tablename IN ('tenant', 'zona')
          AND cmd IN ('SELECT', 'ALL') AND roles && ARRAY['public', 'anon']::name[]`
    );
    assert.deepEqual(abiertas.rows, []);
    const manuales = await client.query("SELECT policyname FROM pg_policies WHERE policyname IN ('lectura_global_tenant', 'lectura_global_zona')");
    assert.deepEqual(manuales.rows, []);
  });
});

test('SCRUM-1720: es idempotente, se registra una sola vez y no toca los datos', opts, async (t) => {
  await enTransaccion(t, async (client) => {
    const { tenant, zona } = await sembrar(client);
    const propias = () =>
      client.query('SELECT (SELECT count(*) FROM tenant WHERE id = $1)::int AS tenants, (SELECT count(*) FROM zona WHERE id = $2)::int AS zonas', [tenant, zona]);
    const antes = (await propias()).rows[0];

    await client.query(MIGRACION);
    await client.query(MIGRACION);

    assert.deepEqual((await propias()).rows[0], antes);
    const registro = await client.query("SELECT count(*)::int AS n FROM schema_migrations WHERE version = '0044'");
    assert.equal(registro.rows[0].n, 1);
  });
});
