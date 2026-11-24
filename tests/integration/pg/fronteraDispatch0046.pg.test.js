// SCRUM-1660 (QAS-20, ADR-0030): después de la 0044 (SCRUM-1720) y de la 0046, `anon` y Dispatch no leen `tenant` ni
// `zona` (permission denied), Dispatch tampoco lee `solicitud`, y Core y `authenticated` siguen leyendo.
// Se omite sin TEST_DATABASE_URL; en CI corre siempre.
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
const migracion = (archivo) => fs.readFileSync(path.join(__dirname, '../../../db/migrations', archivo), 'utf8');

const M0044 = migracion('0044_retirar_lectura_publica_tenant_zona.sql');
const M0046 = migracion('0046_retirar_lecturas_core_en_dispatch.sql');

async function enTransaccion(t, fn) {
  const fabrica = new PgPoolFactory({ databaseUrl: url });
  t.after(() => fabrica.close());
  const client = await fabrica.getPool().connect();
  try {
    await client.query('BEGIN');
    // Todos los candados al empezar y en orden fijo: otros archivos pg insertan en estas tablas en paralelo, y tomar
    // uno, esperar otro y cruzarse con ellos daba deadlock (40P01) en fondosGarantia.pg.test.js.
    await client.query('LOCK TABLE tenant, zona, solicitud IN ACCESS EXCLUSIVE MODE');
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

/**
 * Estado anterior a la 0046: Dispatch con lectura sobre tenant, zona y solicitud. En CI la base ya trae todas las
 * migraciones, así que sin esto la 0046 ya estaría aplicada y la prueba no mediría nada.
 */
async function antesDe0046(client) {
  await client.query('GRANT SELECT ON tenant, zona, solicitud TO mani_dispatch_svc');
}

async function sembrar(client) {
  const tenant = uuid();
  await client.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T1660', $2, 'ACTIVO')", [tenant, `t1660-${tenant}`]);
  await client.query("INSERT INTO zona (id, nivel, nombre, zona_padre_id, estado) VALUES ($1, 'LOCALIDAD', 'Z1660', NULL, 'ACTIVO')", [uuid()]);
}

test('SCRUM-1660: tras la 0044 y la 0046, anon y Dispatch reciben permission denied en tenant y zona', opts, async (t) => {
  await enTransaccion(t, async (client) => {
    await sembrar(client);
    await antesDe0046(client);
    await client.query(M0044);
    // Con solo la 0044, Dispatch todavía lee: es lo que la 0046 le quita.
    assert.ok((await leerComo(client, 'mani_dispatch_svc', 'tenant')).n > 0, 'con la 0044 sola, Dispatch aún lee tenant');

    await client.query(M0046);

    for (const rol of ['anon', 'mani_dispatch_svc']) {
      for (const tabla of ['tenant', 'zona']) {
        assert.equal((await leerComo(client, rol, tabla)).error?.code, '42501', `${rol} no debe leer ${tabla}`);
      }
    }
    assert.equal((await leerComo(client, 'mani_dispatch_svc', 'solicitud')).error?.code, '42501', 'Dispatch no debe leer solicitud');
  });
});

test('SCRUM-1660: tras la 0044 y la 0046, Core y authenticated siguen leyendo tenant y zona', opts, async (t) => {
  await enTransaccion(t, async (client) => {
    await sembrar(client);
    await antesDe0046(client);
    await client.query(M0044);
    await client.query(M0046);

    for (const rol of ['mani_core_svc', 'authenticated']) {
      assert.ok((await leerComo(client, rol, 'tenant')).n > 0, `${rol} debe leer tenant`);
      assert.ok((await leerComo(client, rol, 'zona')).n > 0, `${rol} debe leer zona`);
    }
    // solicitud se filtra por tenant (sin contexto, 0 filas), pero Core no recibe permission denied.
    assert.equal((await leerComo(client, 'mani_core_svc', 'solicitud')).error, undefined);
  });
});

test('SCRUM-1660: la 0046 no reabre tenant ni zona a anon y se registra una sola vez como 0046', opts, async (t) => {
  await enTransaccion(t, async (client) => {
    await antesDe0046(client);
    await client.query(M0044);
    await client.query(M0046);
    await client.query(M0046);

    const abiertas = await client.query(
      `SELECT tablename, policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename IN ('tenant', 'zona')
          AND cmd IN ('SELECT', 'ALL') AND roles && ARRAY['public', 'anon', 'mani_dispatch_svc']::name[]`
    );
    assert.deepEqual(abiertas.rows, []);
    const registro = await client.query("SELECT count(*)::int AS n FROM schema_migrations WHERE version = '0046'");
    assert.equal(registro.rows[0].n, 1);
  });
});
