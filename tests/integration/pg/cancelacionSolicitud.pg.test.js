// US-04.5.1 (SCRUM-877): cancelación de la solicitud contra PostgreSQL real con el esquema oficial.
// Se omite sin TEST_DATABASE_URL; en CI corre siempre. Preparación local: la misma de seguimientoSolicitud.pg.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgServiceRequestRepository = require('../../../src/infrastructure/repositories/PgServiceRequestRepository');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };

const uuid = () => crypto.randomUUID();

async function seedTenant(pool) {
  const s = { tenant: uuid(), zona: uuid(), categoria: uuid() };
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [s.tenant, `t-${s.tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, zona_padre_id, estado) VALUES ($1, 'LOCALIDAD', 'Chapinero', NULL, 'ACTIVO')", [s.zona]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Plomeria', 'ACTIVO')", [s.categoria, s.tenant]);
  return s;
}

async function addCliente(pool, s) {
  const c = { usuario: uuid(), cliente: uuid(), sitio: uuid() };
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVO')", [c.usuario, s.tenant, `${c.usuario}@t.test`]);
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [c.cliente, s.tenant, c.usuario]);
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1')", [c.sitio, s.tenant, c.cliente, s.zona]);
  return c;
}

async function addAliado(pool, s) {
  const a = { usuario: uuid(), aliado: uuid() };
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'ALIADO', 'ACTIVO')", [a.usuario, s.tenant, `${a.usuario}@t.test`]);
  await pool.query(
    "INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'Ana', 'VERIFICADO')",
    [a.aliado, s.tenant, a.usuario]
  );
  return a;
}

async function addSolicitud(pool, s, c, { estado = 'PENDIENTE', aliado = null } = {}) {
  const id = uuid();
  await pool.query(
    `INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, aliado_id, estado)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, s.tenant, c.cliente, c.sitio, s.categoria, s.zona, aliado, estado]
  );
  return id;
}

const estadoDe = async (pool, id) => (await pool.query('SELECT estado FROM solicitud WHERE id = $1', [id])).rows[0].estado;
const eventosDe = async (pool, id) =>
  (await pool.query("SELECT descripcion FROM evento_servicio WHERE solicitud_id = $1 AND tipo_evento = 'SOLICITUD_CANCELADA'", [id])).rows;

test('PG cancelación: el cliente cancela antes de la ejecución, queda persistido y el aliado asignado recibe el aviso', opts, async (t) => {
  const factory = new PgPoolFactory({ databaseUrl: url });
  t.after(() => factory.close());
  const pool = factory.getPool();
  const repo = new PgServiceRequestRepository({ pgPoolFactory: factory });

  const s = await seedTenant(pool);
  const ana = await addCliente(pool, s);
  const aliado = await addAliado(pool, s);
  const pendiente = await addSolicitud(pool, s, ana);
  const asignada = await addSolicitud(pool, s, ana, { estado: 'ASIGNADA', aliado: aliado.aliado });
  const enEjecucion = await addSolicitud(pool, s, ana, { estado: 'EN_EJECUCION', aliado: aliado.aliado });
  const ctxAna = { tenantId: s.tenant, userId: ana.usuario, role: 'CLIENT' };

  // C1: la cancelación queda persistida, con el evento y el motivo, y la respuesta trae el estado nuevo.
  const r = await repo.cancelar(ctxAna, { solicitudId: pendiente, motivo: 'Ya no lo necesito' });
  assert.equal(r.cancelada, true);
  assert.equal(r.solicitud.estado, 'CANCELADA');
  assert.equal(await estadoDe(pool, pendiente), 'CANCELADA');
  assert.deepEqual(await eventosDe(pool, pendiente), [{ descripcion: 'Ya no lo necesito' }]);

  // Repetir es idempotente: no hay un segundo evento.
  assert.equal((await repo.cancelar(ctxAna, { solicitudId: pendiente })).cancelada, false);
  assert.equal((await eventosDe(pool, pendiente)).length, 1);

  // Con aliado asignado, la notificación queda en la bandeja del aliado.
  await repo.cancelar(ctxAna, { solicitudId: asignada });
  const avisos = await pool.query(
    "SELECT payload FROM notificacion WHERE usuario_id = $1 AND tenant_id = $2 AND tipo = 'SOLICITUD_CANCELADA'",
    [aliado.usuario, s.tenant]
  );
  assert.deepEqual(avisos.rows.map((x) => x.payload), [{ requestId: asignada }]);

  // Ya en ejecución no se cancela.
  await assert.rejects(() => repo.cancelar(ctxAna, { solicitudId: enEjecucion }), (e) => e.code === 'MANI-SOL-409C');
  assert.equal(await estadoDe(pool, enEjecucion), 'EN_EJECUCION');
});

test('PG cancelación: ni otro cliente del tenant ni otro tenant pueden cancelar la solicitud ajena (C3)', opts, async (t) => {
  const factory = new PgPoolFactory({ databaseUrl: url });
  t.after(() => factory.close());
  const pool = factory.getPool();
  const repo = new PgServiceRequestRepository({ pgPoolFactory: factory });

  const s = await seedTenant(pool);
  const ana = await addCliente(pool, s);
  const beto = await addCliente(pool, s);
  const deAna = await addSolicitud(pool, s, ana);
  const otro = await seedTenant(pool);

  for (const ctx of [
    { tenantId: s.tenant, userId: beto.usuario, role: 'CLIENT' },
    { tenantId: otro.tenant, userId: ana.usuario, role: 'CLIENT' },
  ]) {
    await assert.rejects(() => repo.cancelar(ctx, { solicitudId: deAna }), (e) => e.statusCode === 404 && e.code === 'MANI-SOL-404');
  }
  assert.equal(await estadoDe(pool, deAna), 'PENDIENTE');
});
