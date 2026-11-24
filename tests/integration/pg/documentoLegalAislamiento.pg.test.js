// SCRUM-1659 (T-22, QAS-01): `documento_legal` solo se ve y se escribe dentro del tenant, como `mani_core_svc`.
// Se omite sin TEST_DATABASE_URL; en CI corre siempre.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { fabricasPg } = require('../../helpers/pgPruebas');
const { runInTenantContext } = require('../../../src/infrastructure/db/runInTenantContext');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };
const uuid = () => crypto.randomUUID();
const MIGRACION = path.join(__dirname, '../../../db/migrations/0040_documento_legal_solo_del_tenant.sql');

async function tenantConDocumento(pool, tipo) {
  const id = uuid();
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [id, `t-${id}`]);
  const doc = uuid();
  await pool.query(
    "INSERT INTO documento_legal (id, tenant_id, tipo, version, contenido, is_active) VALUES ($1, $2, $3, '1', 'propio', true)",
    [doc, id, tipo]
  );
  return { id, doc };
}

const ctx = (tenantId) => ({ tenantId, userId: uuid(), role: 'CLIENT' });
const leer = (core, tenantId, sql, params = []) => runInTenantContext(core, ctx(tenantId), async (c) => (await c.query(sql, params)).rows);

test('PG 1659 C1: un tenant no ve los documentos de otro tenant ni los globales', opts, async (t) => {
  const { pool, core } = fabricasPg(t, url);
  const a = await tenantConDocumento(pool, `PRIV-${uuid()}`);
  const b = await tenantConDocumento(pool, `TERM-${uuid()}`);
  const global = uuid();
  await pool.query("INSERT INTO documento_legal (id, tenant_id, tipo, version, contenido, is_active) VALUES ($1, NULL, $2, '1', 'global', true)", [global, `GLOB-${uuid()}`]);

  const verA = await leer(core, a.id, 'SELECT id, tenant_id FROM documento_legal');
  assert.ok(verA.some((d) => d.id === a.doc), 've el suyo');
  assert.ok(!verA.some((d) => d.id === b.doc), 'no ve el de otro tenant');
  assert.ok(!verA.some((d) => d.id === global), 'no ve el global');
  assert.ok(verA.every((d) => d.tenant_id === a.id), 'todas las filas visibles son del tenant fijado');
});

test('PG 1659 C2: no se puede insertar un documento global ni de otro tenant', opts, async (t) => {
  const { pool, core } = fabricasPg(t, url);
  const a = await tenantConDocumento(pool, `PRIV-${uuid()}`);
  const b = await tenantConDocumento(pool, `TERM-${uuid()}`);
  const insertar = (tenantId, valor) =>
    runInTenantContext(core, ctx(tenantId), (c) =>
      c.query("INSERT INTO documento_legal (tenant_id, tipo, version, contenido, is_active) VALUES ($1, $2, '9', 'x', true)", [valor, `NUEVO-${uuid()}`])
    );

  await assert.rejects(insertar(a.id, null), (err) => err.code === '42501', 'tenant_id nulo violaría la política');
  await assert.rejects(insertar(a.id, b.id), (err) => err.code === '42501', 'otro tenant violaría la política');
  await insertar(a.id, a.id); // el propio sí
});

test('PG 1659 C3: la migración copia los documentos globales a los tenants que no los tienen, y es idempotente', opts, async (t) => {
  const { pool } = fabricasPg(t, url);
  const tipo = `GLOB-${uuid()}`;
  const sin = uuid();
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'Sin docs', $2, 'ACTIVO')", [sin, `t-${sin}`]);
  const con = uuid();
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'Con doc', $2, 'ACTIVO')", [con, `t-${con}`]);
  await pool.query("INSERT INTO documento_legal (tenant_id, tipo, version, contenido, is_active) VALUES (NULL, $1, '1', 'global', true)", [tipo]);
  await pool.query("INSERT INTO documento_legal (tenant_id, tipo, version, contenido, is_active) VALUES ($1, $2, '1', 'propio', true)", [con, tipo]);

  const sql = fs.readFileSync(MIGRACION, 'utf8');
  await pool.query(sql);
  await pool.query(sql); // reaplicar no duplica

  const copias = await pool.query('SELECT tenant_id, contenido FROM documento_legal WHERE tipo = $1 AND tenant_id IS NOT NULL ORDER BY contenido', [tipo]);
  const deSin = copias.rows.filter((r) => r.tenant_id === sin);
  const deCon = copias.rows.filter((r) => r.tenant_id === con);
  assert.equal(deSin.length, 1, 'el tenant sin documento recibe una copia');
  assert.equal(deSin[0].contenido, 'global');
  assert.equal(deCon.length, 1, 'el que ya tenía uno no recibe otra copia');
  assert.equal(deCon[0].contenido, 'propio');
  assert.equal((await pool.query('SELECT 1 FROM documento_legal WHERE tipo = $1 AND tenant_id IS NULL', [tipo])).rows.length, 1, 'el global no se borra');
});
