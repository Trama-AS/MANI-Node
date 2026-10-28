// HU-M09-04 (SCRUM-883): la consulta de conversaciones para atender quejas contra PostgreSQL real, conectados como
// `mani_core_svc` (sin BYPASSRLS) para que las políticas RLS sí se evalúen. Se omite sin TEST_DATABASE_URL.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgMessageRepository = require('../../../src/infrastructure/repositories/PgMessageRepository');
const { runInTenantContext } = require('../../../src/infrastructure/db/runInTenantContext');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };
const uuid = () => crypto.randomUUID();
const comoCore = (u) => `${u}${u.includes('?') ? '&' : '?'}options=-c%20role%3Dmani_core_svc`;

async function sembrarTenant(pool, { estado = 'ACEPTADA' } = {}) {
  const s = { tenant: uuid(), usuarioCliente: uuid(), usuarioAliado: uuid(), usuarioAdmin: uuid(), cliente: uuid(), aliado: uuid(), solicitud: uuid() };
  const zona = uuid();
  const categoria = uuid();
  const sitio = uuid();
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [s.tenant, `t-${s.tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, estado) VALUES ($1, 'CIUDAD', 'Z', 'ACTIVO')", [zona]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Plomeria', 'ACTIVO')", [categoria, s.tenant]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVO')", [s.usuarioCliente, s.tenant, `${s.usuarioCliente}@t.test`]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'ADMIN_TENANT', 'ACTIVO')", [s.usuarioAdmin, s.tenant, `${s.usuarioAdmin}@t.test`]);
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
    comoAdmin: { tenantId: s.tenant, userId: s.usuarioAdmin, role: 'ADMIN' },
  };
}

async function entorno(t) {
  const admin = new PgPoolFactory({ databaseUrl: url });
  const core = new PgPoolFactory({ databaseUrl: comoCore(url) });
  t.after(() => Promise.all([admin.close(), core.close()]));
  return { pool: admin.getPool(), core, repo: new PgMessageRepository({ pgPoolFactory: core }) };
}

const msg = (s, contenido) => ({ solicitudId: s.solicitud, contenido, claveIdempotencia: null });
const consulta = (s, extra = {}) => ({ solicitudId: s.solicitud, motivo: 'Queja por retraso del servicio', quejaRef: null, limite: 50, despuesDe: null, correlationId: 'corr-883', ...extra });

test('PG C1: el administrador lee la conversación completa y queda su consulta con motivo, actor y correlación', opts, async (t) => {
  const { pool, repo } = await entorno(t);
  const s = await sembrarTenant(pool);
  await repo.enviar(s.comoCliente, msg(s, '¿A qué hora llega?'));
  await repo.enviar(s.comoAliado, msg(s, 'A las 3 pm'));

  const { consulta: c, mensajes } = await repo.consultarConversacion(s.comoAdmin, consulta(s, { quejaRef: 'Q-15' }));

  assert.deepEqual(mensajes.map((m) => m.contenido), ['¿A qué hora llega?', 'A las 3 pm']);
  assert.deepEqual(mensajes.map((m) => m.remitente.rol), ['CLIENT', 'ALLY']);
  assert.equal(mensajes.every((m) => m.mio === false), true, 'el administrador no es ninguno de los dos');
  assert.equal(c.mensajesVistos, 2);
  const fila = (await pool.query('SELECT * FROM consulta_conversacion WHERE id = $1', [c.id])).rows[0];
  assert.equal(fila.tenant_id, s.tenant);
  assert.equal(fila.solicitud_id, s.solicitud);
  assert.equal(fila.actor_id, s.usuarioAdmin, 'el actor sale de la sesión');
  assert.equal(fila.actor_rol, 'ADMIN');
  assert.equal(fila.motivo, 'Queja por retraso del servicio');
  assert.equal(fila.queja_ref, 'Q-15');
  assert.equal(fila.correlation_id, 'corr-883');
  assert.equal(fila.mensajes_vistos, 2);
});

test('PG C1: lee una conversación de un servicio ya finalizado o cancelado', opts, async (t) => {
  const { pool, repo } = await entorno(t);
  const s = await sembrarTenant(pool);
  await repo.enviar(s.comoCliente, msg(s, 'antes de cerrar'));
  for (const estado of ['FINALIZADA', 'CANCELADA']) {
    await pool.query('UPDATE solicitud SET estado = $1 WHERE id = $2', [estado, s.solicitud]);
    const { mensajes } = await repo.consultarConversacion(s.comoAdmin, consulta(s));
    assert.equal(mensajes.length, 1, estado);
  }
});

test('PG C2: una conversación sin mensajes devuelve lista vacía y también queda auditada', opts, async (t) => {
  const { pool, repo } = await entorno(t);
  const s = await sembrarTenant(pool);

  const { consulta: c, mensajes } = await repo.consultarConversacion(s.comoAdmin, consulta(s));

  assert.deepEqual(mensajes, []);
  assert.equal(c.mensajesVistos, 0);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM consulta_conversacion WHERE solicitud_id = $1', [s.solicitud])).rows[0].n, 1);
});

test('PG: el cursor devuelve solo lo posterior y cada consulta deja su propio registro', opts, async (t) => {
  const { pool, repo } = await entorno(t);
  const s = await sembrarTenant(pool);
  const a = (await repo.enviar(s.comoCliente, msg(s, 'uno'))).mensaje;
  await repo.enviar(s.comoAliado, msg(s, 'dos'));

  const { mensajes } = await repo.consultarConversacion(s.comoAdmin, consulta(s, { despuesDe: a.id }));
  assert.deepEqual(mensajes.map((m) => m.contenido), ['dos']);
  await repo.consultarConversacion(s.comoAdmin, consulta(s));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM consulta_conversacion WHERE solicitud_id = $1', [s.solicitud])).rows[0].n, 2);
  await assert.rejects(() => repo.consultarConversacion(s.comoAdmin, consulta(s, { despuesDe: uuid() })), (err) => err.statusCode === 400 && err.code === 'MANI-MSG-400');
});

test('PG C3: el administrador de otro tenant y una solicitud inexistente responden 404 y no dejan registro', opts, async (t) => {
  const { pool, repo } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  await repo.enviar(a.comoCliente, msg(a, 'privado'));
  const noEncontrado = (err) => err.statusCode === 404 && err.code === 'MANI-MSG-404';

  await assert.rejects(() => repo.consultarConversacion(b.comoAdmin, consulta(a)), noEncontrado);
  await assert.rejects(() => repo.consultarConversacion(a.comoAdmin, consulta(a, { solicitudId: uuid() })), noEncontrado);

  assert.equal((await pool.query('SELECT count(*)::int AS n FROM consulta_conversacion WHERE solicitud_id = $1', [a.solicitud])).rows[0].n, 0);
});

test('PG: la consulta y su auditoría son atómicas: si el registro no se puede guardar no se devuelve la conversación', opts, async (t) => {
  const { pool, repo } = await entorno(t);
  const s = await sembrarTenant(pool);
  await repo.enviar(s.comoCliente, msg(s, 'hola'));

  // Un motivo fuera de la restricción de la tabla (más de 500) obliga a fallar el INSERT de la auditoría.
  await assert.rejects(() => repo.consultarConversacion(s.comoAdmin, consulta(s, { motivo: 'x'.repeat(501) })), (err) => err.code === '23514');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM consulta_conversacion WHERE solicitud_id = $1', [s.solicitud])).rows[0].n, 0);
});

test('PG C3: el registro de consultas es inmutable aun para el dueño de la tabla y para el rol de servicio', opts, async (t) => {
  const { pool, core, repo } = await entorno(t);
  const s = await sembrarTenant(pool);
  const { consulta: c } = await repo.consultarConversacion(s.comoAdmin, consulta(s));

  await assert.rejects(() => pool.query("UPDATE consulta_conversacion SET motivo = 'otro motivo' WHERE id = $1", [c.id]), /inmutable/);
  await assert.rejects(() => pool.query('DELETE FROM consulta_conversacion WHERE id = $1', [c.id]), /inmutable/);
  await assert.rejects(() => pool.query('TRUNCATE consulta_conversacion'), /inmutable/);
  await assert.rejects(
    () => runInTenantContext(core, s.comoAdmin, (cl) => cl.query("UPDATE consulta_conversacion SET motivo = 'otro motivo' WHERE id = $1", [c.id])),
    (err) => err.code === '42501'
  );
  await assert.rejects(
    () => runInTenantContext(core, s.comoAdmin, (cl) => cl.query('DELETE FROM consulta_conversacion WHERE id = $1', [c.id])),
    (err) => err.code === '42501'
  );
  assert.equal((await pool.query('SELECT motivo FROM consulta_conversacion WHERE id = $1', [c.id])).rows[0].motivo, 'Queja por retraso del servicio');
});

test('PG C3: el listado de consultas es del tenant, en orden y con cursor; RLS aísla aunque no se filtre', opts, async (t) => {
  const { pool, core, repo } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  const primera = (await repo.consultarConversacion(a.comoAdmin, consulta(a, { motivo: 'primera consulta' }))).consulta;
  const segunda = (await repo.consultarConversacion(a.comoAdmin, consulta(a, { motivo: 'segunda consulta' }))).consulta;
  await repo.consultarConversacion(b.comoAdmin, consulta(b));

  const todas = (await repo.listarConsultas(a.comoAdmin, { limite: 50, despuesDe: null, solicitudId: null })).consultas;
  assert.deepEqual(todas.map((c) => c.motivo), ['primera consulta', 'segunda consulta']);
  assert.deepEqual(todas[0].actor, { id: a.usuarioAdmin, rol: 'ADMIN' });
  assert.deepEqual(
    (await repo.listarConsultas(a.comoAdmin, { limite: 50, despuesDe: primera.id, solicitudId: null })).consultas.map((c) => c.id),
    [segunda.id]
  );
  assert.equal((await repo.listarConsultas(a.comoAdmin, { limite: 50, despuesDe: null, solicitudId: uuid() })).consultas.length, 0);
  await assert.rejects(
    () => repo.listarConsultas(b.comoAdmin, { limite: 50, despuesDe: primera.id, solicitudId: null }),
    (err) => err.statusCode === 400 && err.code === 'MANI-MSG-400',
    'el cursor de otro tenant no existe'
  );

  const visibles = await runInTenantContext(core, b.comoAdmin, (c) => c.query('SELECT count(*)::int AS n FROM consulta_conversacion'));
  assert.equal(visibles.rows[0].n, 1, 'RLS: el tenant B solo ve la suya');
  await assert.rejects(
    () => runInTenantContext(core, b.comoAdmin, (c) =>
      c.query("INSERT INTO consulta_conversacion (tenant_id, solicitud_id, actor_id, actor_rol, motivo, mensajes_vistos) VALUES ($1, $2, $3, 'ADMIN', 'intruso en otro tenant', 0)", [a.tenant, a.solicitud, b.usuarioAdmin])),
    (err) => err.code === '42501'
  );
});
