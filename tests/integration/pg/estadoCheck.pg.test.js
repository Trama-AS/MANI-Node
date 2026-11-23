// SCRUM-1713 (QAS-10): la base rechaza estados fuera del catálogo en solicitud y cotizacion (migración 0043).
// Se omite sin TEST_DATABASE_URL; en CI corre siempre. Preparación local: la de seguimientoSolicitud.pg.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { fabricasPg } = require('../../helpers/pgPruebas');
const { ESTADOS_SOLICITUD, ESTADOS_COTIZACION } = require('../../../src/domain/estados');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };
const uuid = () => crypto.randomUUID();

async function sembrar(pool) {
  const s = { tenant: uuid(), zona: uuid(), categoria: uuid(), usuarioCliente: uuid(), cliente: uuid(), sitio: uuid(), usuarioAliado: uuid(), aliado: uuid() };
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [s.tenant, `t-${s.tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, zona_padre_id, estado) VALUES ($1, 'LOCALIDAD', 'Chapinero', NULL, 'ACTIVO')", [s.zona]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Plomeria', 'ACTIVO')", [s.categoria, s.tenant]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVO')", [s.usuarioCliente, s.tenant, `${s.usuarioCliente}@t.test`]);
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [s.cliente, s.tenant, s.usuarioCliente]);
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1')", [s.sitio, s.tenant, s.cliente, s.zona]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'ALIADO', 'ACTIVO')", [s.usuarioAliado, s.tenant, `${s.usuarioAliado}@t.test`]);
  await pool.query(
    "INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'Ana', 'VERIFICADO')",
    [s.aliado, s.tenant, s.usuarioAliado]
  );
  return s;
}

const insertarSolicitud = (pool, s, estado) => {
  const id = uuid();
  return pool
    .query(
      `INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, aliado_id, estado)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, s.tenant, s.cliente, s.sitio, s.categoria, s.zona, s.aliado, estado]
    )
    .then(() => id);
};

const insertarCotizacion = (pool, s, solicitudId, estado) =>
  pool.query(
    `INSERT INTO cotizacion (tenant_id, solicitud_id, aliado_id, valor_mano_obra, valor_materiales, estado)
     VALUES ($1, $2, $3, 100000, 20000, $4)`,
    [s.tenant, solicitudId, s.aliado, estado]
  );

const violaCheck = (nombre) => (err) => err.code === '23514' && err.constraint === nombre;

test('SCRUM-1713: la base guarda todos los estados del catálogo y rechaza los inventados', opts, async (t) => {
  const { pool } = fabricasPg(t, url);
  const s = await sembrar(pool);

  for (const estado of ESTADOS_SOLICITUD) await insertarSolicitud(pool, s, estado);
  await assert.rejects(insertarSolicitud(pool, s, 'INVENTADO_1713'), violaCheck('ck_solicitud_estado'));
  await assert.rejects(insertarSolicitud(pool, s, 'CANCELADO'), violaCheck('ck_solicitud_estado'));
  await assert.rejects(insertarSolicitud(pool, s, 'EN_EJECUCIÓN'), violaCheck('ck_solicitud_estado'));

  const base = await insertarSolicitud(pool, s, 'PENDIENTE');
  for (const estado of ESTADOS_COTIZACION) await insertarCotizacion(pool, s, base, estado);
  await assert.rejects(insertarCotizacion(pool, s, base, 'INVENTADO_1713'), violaCheck('ck_cotizacion_estado'));
});

test('SCRUM-1713: actualizar un estado a un valor inventado se rechaza (el caso que reprodujo QA)', opts, async (t) => {
  const { pool } = fabricasPg(t, url);
  const s = await sembrar(pool);
  const id = await insertarSolicitud(pool, s, 'PENDIENTE');
  await insertarCotizacion(pool, s, id, 'PENDIENTE');

  await assert.rejects(pool.query("UPDATE solicitud SET estado = 'INVENTADO_1713' WHERE id = $1", [id]), violaCheck('ck_solicitud_estado'));
  await assert.rejects(pool.query("UPDATE cotizacion SET estado = 'INVENTADO_1713' WHERE solicitud_id = $1", [id]), violaCheck('ck_cotizacion_estado'));
  await pool.query("UPDATE solicitud SET estado = 'ASIGNADA' WHERE id = $1", [id]);
});

test('SCRUM-1713: aplicar la 0043 otra vez no falla ni cambia nada (idempotente)', opts, async (t) => {
  const { pool } = fabricasPg(t, url);
  const sql = fs.readFileSync(path.join(__dirname, '../../../db/migrations/0043_estado_solicitud_cotizacion_check.sql'), 'utf8');

  await pool.query(sql);

  const { rows } = await pool.query(
    "SELECT conname, convalidated FROM pg_constraint WHERE conname IN ('ck_solicitud_estado', 'ck_cotizacion_estado') ORDER BY conname"
  );
  assert.deepEqual(rows.map((r) => r.conname), ['ck_cotizacion_estado', 'ck_solicitud_estado']);
  const registro = await pool.query("SELECT count(*)::int AS n FROM schema_migrations WHERE version = '0043'");
  assert.equal(registro.rows[0].n, 1);
});
