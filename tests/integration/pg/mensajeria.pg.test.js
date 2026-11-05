// HU-M09-02 (SCRUM-881): la mensajería cliente-aliado contra PostgreSQL real, conectados como `mani_core_svc` (sin
// BYPASSRLS) para que las políticas RLS sí se evalúen. Se omite sin TEST_DATABASE_URL.
// Preparación local: la misma que pagos.pg.test.js, con db/migrations/0001-0017.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgMessageRepository = require('../../../src/infrastructure/repositories/PgMessageRepository');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };
const uuid = () => crypto.randomUUID();
const comoCore = (u) => `${u}${u.includes('?') ? '&' : '?'}options=-c%20role%3Dmani_core_svc`;

async function sembrarTenant(pool, { estado = 'ACEPTADA' } = {}) {
  const s = { tenant: uuid(), usuarioCliente: uuid(), usuarioAliado: uuid(), cliente: uuid(), aliado: uuid(), solicitud: uuid() };
  const zona = uuid();
  const categoria = uuid();
  const sitio = uuid();
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [s.tenant, `t-${s.tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, estado) VALUES ($1, 'CIUDAD', 'Z', 'ACTIVO')", [zona]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Plomeria', 'ACTIVO')", [categoria, s.tenant]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVO')", [s.usuarioCliente, s.tenant, `${s.usuarioCliente}@t.test`]);
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [s.cliente, s.tenant, s.usuarioCliente]);
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1')", [sitio, s.tenant, s.cliente, zona]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'ALIADO', 'ACTIVO')", [s.usuarioAliado, s.tenant, `${s.usuarioAliado}@t.test`]);
  await pool.query("INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'Ana', 'VERIFICADO')", [s.aliado, s.tenant, s.usuarioAliado]);
  await pool.query(
    'INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, aliado_id, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [s.solicitud, s.tenant, s.cliente, sitio, categoria, zona, s.aliado, estado]
  );
  return {
    ...s,
    comoCliente: { tenantId: s.tenant, userId: s.usuarioCliente, role: 'CLIENT' },
    comoAliado: { tenantId: s.tenant, userId: s.usuarioAliado, role: 'ALLY' },
  };
}

async function entorno(t) {
  const admin = new PgPoolFactory({ databaseUrl: url });
  const core = new PgPoolFactory({ databaseUrl: comoCore(url) });
  t.after(() => Promise.all([admin.close(), core.close()]));
  return { pool: admin.getPool(), repo: new PgMessageRepository({ pgPoolFactory: core }) };
}

const msg = (s, contenido, claveIdempotencia = null) => ({ solicitudId: s.solicitud, contenido, claveIdempotencia });

test('PG: cliente y aliado intercambian mensajes y cada uno ve el hilo completo en orden', opts, async (t) => {
  const { pool, repo } = await entorno(t);
  const s = await sembrarTenant(pool);

  const a = await repo.enviar(s.comoCliente, msg(s, 'Hola, ¿a qué hora llega?'));
  const b = await repo.enviar(s.comoAliado, msg(s, 'A las 3 pm'));
  assert.equal(a.creado, true);
  assert.equal(a.mensaje.mio, true);
  assert.equal(a.mensaje.remitente.rol, 'CLIENT');

  const vistoPorAliado = (await repo.listar(s.comoAliado, { solicitudId: s.solicitud, despuesDe: null, limite: 50 })).mensajes;
  assert.deepEqual(vistoPorAliado.map((m) => m.contenido), ['Hola, ¿a qué hora llega?', 'A las 3 pm']);
  assert.deepEqual(vistoPorAliado.map((m) => m.mio), [false, true]);
  assert.deepEqual(vistoPorAliado.map((m) => m.remitente.rol), ['CLIENT', 'ALLY']);
  assert.equal(b.mensaje.id, vistoPorAliado[1].id);

  const fila = (await pool.query('SELECT tenant_id, remitente_id FROM mensaje WHERE id = $1', [a.mensaje.id])).rows[0];
  assert.equal(fila.tenant_id, s.tenant);
  assert.equal(fila.remitente_id, s.usuarioCliente, 'el remitente sale de la sesión');
});

test('PG: la consulta incremental devuelve solo lo posterior a despuesDe y la primera carga, los últimos del límite', opts, async (t) => {
  const { pool, repo } = await entorno(t);
  const s = await sembrarTenant(pool);
  const ids = [];
  for (const texto of ['uno', 'dos', 'tres', 'cuatro']) ids.push((await repo.enviar(s.comoCliente, msg(s, texto))).mensaje.id);

  const nuevos = await repo.listar(s.comoAliado, { solicitudId: s.solicitud, despuesDe: ids[1], limite: 50 });
  assert.deepEqual(nuevos.mensajes.map((m) => m.contenido), ['tres', 'cuatro']);

  const ultimos = await repo.listar(s.comoAliado, { solicitudId: s.solicitud, despuesDe: null, limite: 2 });
  assert.deepEqual(ultimos.mensajes.map((m) => m.contenido), ['tres', 'cuatro'], 'los 2 más recientes, del más antiguo al más reciente');

  const vacio = await repo.listar(s.comoAliado, { solicitudId: s.solicitud, despuesDe: ids[3], limite: 50 });
  assert.deepEqual(vacio.mensajes, []);

  await assert.rejects(
    () => repo.listar(s.comoAliado, { solicitudId: s.solicitud, despuesDe: uuid(), limite: 50 }),
    (err) => err.statusCode === 400 && err.code === 'MANI-MSG-400'
  );
});

test('PG: un reintento con la misma clave devuelve el mensaje ya guardado y no lo duplica', opts, async (t) => {
  const { pool, repo } = await entorno(t);
  const s = await sembrarTenant(pool);
  const clave = uuid();

  const primero = await repo.enviar(s.comoCliente, msg(s, 'una vez', clave));
  const reintento = await repo.enviar(s.comoCliente, msg(s, 'una vez', clave));
  const enParalelo = await Promise.all([repo.enviar(s.comoCliente, msg(s, 'carrera', uuid())), repo.enviar(s.comoAliado, msg(s, 'una vez', clave))]);

  assert.equal(primero.creado, true);
  assert.equal(reintento.creado, false);
  assert.equal(reintento.mensaje.id, primero.mensaje.id);
  assert.equal(enParalelo[1].creado, true, 'la misma clave de OTRO remitente es otro mensaje');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM mensaje WHERE solicitud_id = $1', [s.solicitud])).rows[0].n, 3);
});

test('PG: dos envíos simultáneos con la misma clave guardan un solo mensaje', opts, async (t) => {
  const { pool, repo } = await entorno(t);
  const s = await sembrarTenant(pool);
  const clave = uuid();

  const res = await Promise.all([repo.enviar(s.comoCliente, msg(s, 'doble', clave)), repo.enviar(s.comoCliente, msg(s, 'doble', clave))]);

  assert.equal(res.filter((r) => r.creado).length, 1);
  assert.equal(res[0].mensaje.id, res[1].mensaje.id);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM mensaje WHERE solicitud_id = $1', [s.solicitud])).rows[0].n, 1);
});

test('PG C3: otro tenant, otro cliente o otro aliado del mismo tenant no leen ni escriben (404)', opts, async (t) => {
  const { pool, repo } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  await repo.enviar(a.comoCliente, msg(a, 'privado'));

  const noEncontrado = (err) => err.statusCode === 404 && err.code === 'MANI-MSG-404';
  const lista = { solicitudId: a.solicitud, despuesDe: null, limite: 50 };

  // Otro tenant (cliente y aliado).
  await assert.rejects(() => repo.listar(b.comoCliente, lista), noEncontrado);
  await assert.rejects(() => repo.listar(b.comoAliado, lista), noEncontrado);
  await assert.rejects(() => repo.enviar(b.comoCliente, msg(a, 'intruso')), noEncontrado);

  // Mismo tenant, otro cliente y otro aliado.
  const otroCliente = uuid();
  const otroAliado = uuid();
  for (const [id, rol] of [[otroCliente, 'CLIENTE'], [otroAliado, 'ALIADO']]) {
    await pool.query('INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, $4, \'ACTIVO\')', [id, a.tenant, `${id}@t.test`, rol]);
  }
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [uuid(), a.tenant, otroCliente]);
  await pool.query("INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'Otro', 'VERIFICADO')", [uuid(), a.tenant, otroAliado]);
  for (const ctx of [{ tenantId: a.tenant, userId: otroCliente, role: 'CLIENT' }, { tenantId: a.tenant, userId: otroAliado, role: 'ALLY' }]) {
    await assert.rejects(() => repo.listar(ctx, lista), noEncontrado);
    await assert.rejects(() => repo.enviar(ctx, msg(a, 'intruso')), noEncontrado);
  }

  // El rol del JWT no puede suplantar al otro participante: el aliado no entra como CLIENT.
  await assert.rejects(() => repo.listar({ ...a.comoAliado, role: 'CLIENT' }, lista), noEncontrado);

  assert.equal((await pool.query('SELECT count(*)::int AS n FROM mensaje WHERE solicitud_id = $1', [a.solicitud])).rows[0].n, 1);
  assert.equal((await repo.listar(a.comoAliado, lista)).mensajes.length, 1, 'el aliado asignado sí lo ve');
});

test('PG: RLS aísla los mensajes por tenant aunque la consulta no filtre', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  await pool.query('INSERT INTO mensaje (tenant_id, solicitud_id, remitente_id, contenido) VALUES ($1, $2, $3, $4)', [a.tenant, a.solicitud, a.usuarioCliente, 'del A']);

  const core = new PgPoolFactory({ databaseUrl: comoCore(url) });
  t.after(() => core.close());
  const client = await core.getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT app.set_context($1, $2, 'CLIENTE')", [b.tenant, b.usuarioCliente]);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM mensaje')).rows[0].n, 0, 'el tenant B no ve el mensaje del A');
    await client.query('ROLLBACK');
  } finally {
    client.release();
  }
});

test('PG: los estados finales o sin aliado en curso no admiten mensajes nuevos, pero el hilo se sigue leyendo', opts, async (t) => {
  const { pool, repo } = await entorno(t);
  const s = await sembrarTenant(pool);
  await repo.enviar(s.comoCliente, msg(s, 'antes de cerrar'));

  for (const estado of ['FINALIZADA', 'CANCELADA', 'RECHAZADA']) {
    await pool.query('UPDATE solicitud SET estado = $1 WHERE id = $2', [estado, s.solicitud]);
    await assert.rejects(
      () => repo.enviar(s.comoCliente, msg(s, 'tarde')),
      (err) => err.statusCode === 409 && err.code === 'MANI-MSG-409E',
      estado
    );
    assert.equal((await repo.listar(s.comoCliente, { solicitudId: s.solicitud, despuesDe: null, limite: 50 })).mensajes.length, 1);
  }
  for (const estado of PgMessageRepository.ESTADOS_QUE_ADMITEN_MENSAJES) {
    await pool.query('UPDATE solicitud SET estado = $1 WHERE id = $2', [estado, s.solicitud]);
    await repo.enviar(s.comoAliado, msg(s, `en ${estado}`));
  }
});
