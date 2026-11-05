// HU-M09-03 (SCRUM-882): la notificación de mensajes nuevos contra PostgreSQL real, conectados como `mani_core_svc`
// (sin BYPASSRLS) para que las políticas RLS sí se evalúen. Se omite sin TEST_DATABASE_URL.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgMessageRepository = require('../../../src/infrastructure/repositories/PgMessageRepository');
const PgNotificacionRepository = require('../../../src/infrastructure/repositories/PgNotificacionRepository');
const MessagesUseCase = require('../../../src/application/useCases/messages/MessagesUseCase');
const NotificarEventoServicioUseCase = require('../../../src/application/useCases/notifications/NotificarEventoServicioUseCase');
const MockPushProvider = require('../../../src/infrastructure/push/MockPushProvider');
const { runInTenantContext } = require('../../../src/infrastructure/db/runInTenantContext');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };
const uuid = () => crypto.randomUUID();
const comoCore = (u) => `${u}${u.includes('?') ? '&' : '?'}options=-c%20role%3Dmani_core_svc`;

async function sembrarTenant(pool, { sinAliado = false } = {}) {
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
    "INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, aliado_id, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACEPTADA')",
    [s.solicitud, s.tenant, s.cliente, sitio, categoria, zona, sinAliado ? null : s.aliado]
  );
  return {
    ...s,
    comoCliente: { tenantId: s.tenant, userId: s.usuarioCliente, role: 'CLIENT' },
    comoAliado: { tenantId: s.tenant, userId: s.usuarioAliado, role: 'ALLY' },
  };
}

async function entorno(t, { push = new MockPushProvider() } = {}) {
  const admin = new PgPoolFactory({ databaseUrl: url });
  const core = new PgPoolFactory({ databaseUrl: comoCore(url) });
  t.after(() => Promise.all([admin.close(), core.close()]));
  const notificaciones = new PgNotificacionRepository({ pgPoolFactory: core });
  const notificador = new NotificarEventoServicioUseCase({ notificacionRepository: notificaciones, pushProvider: push, logger: () => {} });
  const mensajes = new MessagesUseCase({ messageRepository: new PgMessageRepository({ pgPoolFactory: core }), notificador });
  return { pool: admin.getPool(), core, push, notificaciones, mensajes };
}

const sesion = (ctx) => ({ tenantId: ctx.tenantId, userId: ctx.userId, role: ctx.role });
const enviar = (mensajes, s, ctx, contenido, claveIdempotencia) =>
  mensajes.enviar({ user: sesion(ctx), solicitudId: s.solicitud, body: { contenido, ...(claveIdempotencia ? { claveIdempotencia } : {}) }, correlationId: 'corr-882' });
const bandeja = (pool, tenant, usuario) =>
  pool.query('SELECT tipo, canal, payload, clave_evento FROM notificacion WHERE tenant_id = $1 AND usuario_id = $2 ORDER BY enviado_at, id', [tenant, usuario]);

test('PG C1: el cliente escribe y el aliado recibe una notificación con remitente y servicio, sin el texto', opts, async (t) => {
  const { pool, push, mensajes } = await entorno(t);
  const s = await sembrarTenant(pool);

  const { mensaje } = await enviar(mensajes, s, s.comoCliente, 'Mi contraseña del wifi es 12345');

  const { rows } = await bandeja(pool, s.tenant, s.usuarioAliado);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tipo, 'MENSAJE_NUEVO');
  assert.equal(rows[0].canal, 'PUSH');
  assert.equal(rows[0].clave_evento, mensaje.id);
  assert.deepEqual(rows[0].payload, { mensajeId: mensaje.id, remitenteRol: 'CLIENT', requestId: s.solicitud, categoria: 'Plomeria' });
  assert.equal(JSON.stringify(rows[0].payload).includes('wifi'), false, 'el texto del mensaje no se copia a la notificación');
  assert.equal(push.sentTo(s.tenant, s.usuarioAliado).length, 1);
  assert.equal((await bandeja(pool, s.tenant, s.usuarioCliente)).rows.length, 0, 'quien escribe no se notifica a sí mismo');
});

test('PG C1: el aliado escribe y el cliente recibe la notificación', opts, async (t) => {
  const { pool, push, mensajes } = await entorno(t);
  const s = await sembrarTenant(pool);

  await enviar(mensajes, s, s.comoAliado, 'Llego en 10 minutos');

  const { rows } = await bandeja(pool, s.tenant, s.usuarioCliente);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].payload.remitenteRol, 'ALLY');
  assert.equal(push.sentTo(s.tenant, s.usuarioCliente).length, 1);
});

test('PG C2: un reintento con la misma clave no crea otra notificación ni otro push', opts, async (t) => {
  const { pool, push, mensajes } = await entorno(t);
  const s = await sembrarTenant(pool);
  const clave = uuid();

  const primero = await enviar(mensajes, s, s.comoCliente, 'una vez', clave);
  const reintento = await enviar(mensajes, s, s.comoCliente, 'una vez', clave);
  const enParalelo = await Promise.all([enviar(mensajes, s, s.comoCliente, 'una vez', clave), enviar(mensajes, s, s.comoCliente, 'una vez', clave)]);

  assert.equal(reintento.creado, false);
  assert.ok(enParalelo.every((r) => r.mensaje.id === primero.mensaje.id));
  assert.equal((await bandeja(pool, s.tenant, s.usuarioAliado)).rows.length, 1);
  assert.equal(push.sent.length, 1);
});

test('PG C2: si el push falla el mensaje queda guardado y la notificación en la bandeja; el reintento no la repite', opts, async (t) => {
  const caido = { name: 'caido', simulated: false, send: async () => { throw new Error('proveedor caído'); } };
  const { pool, mensajes } = await entorno(t, { push: caido });
  const s = await sembrarTenant(pool);
  const clave = uuid();

  const r = await enviar(mensajes, s, s.comoCliente, 'hola', clave);

  assert.equal(r.creado, true);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM mensaje WHERE solicitud_id = $1', [s.solicitud])).rows[0].n, 1);
  assert.equal((await bandeja(pool, s.tenant, s.usuarioAliado)).rows.length, 1);
  await enviar(mensajes, s, s.comoCliente, 'hola', clave);
  assert.equal((await bandeja(pool, s.tenant, s.usuarioAliado)).rows.length, 1);
});

test('PG C2: dos mensajes distintos generan dos notificaciones', opts, async (t) => {
  const { pool, mensajes } = await entorno(t);
  const s = await sembrarTenant(pool);
  await enviar(mensajes, s, s.comoCliente, 'uno');
  await enviar(mensajes, s, s.comoCliente, 'dos');
  assert.equal((await bandeja(pool, s.tenant, s.usuarioAliado)).rows.length, 2);
});

test('PG: sin aliado asignado el mensaje se guarda y no hay a quién notificar', opts, async (t) => {
  const { pool, push, mensajes } = await entorno(t);
  const s = await sembrarTenant(pool, { sinAliado: true });

  const r = await enviar(mensajes, s, s.comoCliente, 'hola');

  assert.equal(r.creado, true);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM notificacion WHERE tenant_id = $1', [s.tenant])).rows[0].n, 0);
  assert.equal(push.sent.length, 0);
});

test('PG C3: otro tenant no recibe nada ni puede crear ni ver notificaciones de este', opts, async (t) => {
  const { pool, core, notificaciones, mensajes } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  await enviar(mensajes, a, a.comoCliente, 'privado');

  assert.equal((await pool.query('SELECT count(*)::int AS n FROM notificacion WHERE tenant_id = $1', [b.tenant])).rows[0].n, 0);
  assert.equal(await notificaciones.participantesDeSolicitud(b.comoCliente, a.solicitud), null, 'la solicitud de A no existe para B');
  assert.equal(await notificaciones.crearParaUsuario(b.comoCliente, { usuarioId: a.usuarioAliado, tipo: 'MENSAJE_NUEVO', canal: 'PUSH', payload: {}, claveEvento: 'x' }), null, 'el usuario de A no existe para B');
  const visibles = await runInTenantContext(core, b.comoCliente, (c) => c.query('SELECT count(*)::int AS n FROM notificacion'));
  assert.equal(visibles.rows[0].n, 0, 'RLS: B no ve las notificaciones de A');
});

test('PG C3: otro cliente u otro aliado del mismo tenant no es destinatario aunque envíe a la solicitud', opts, async (t) => {
  const { pool, push, mensajes } = await entorno(t);
  const s = await sembrarTenant(pool);
  const otro = uuid();
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVO')", [otro, s.tenant, `${otro}@t.test`]);
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [uuid(), s.tenant, otro]);

  await assert.rejects(() => enviar(mensajes, s, { tenantId: s.tenant, userId: otro, role: 'CLIENT' }, 'intruso'), { code: 'MANI-MSG-404' });

  assert.equal((await pool.query('SELECT count(*)::int AS n FROM notificacion WHERE tenant_id = $1', [s.tenant])).rows[0].n, 0);
  assert.equal(push.sent.length, 0);
});

test('PG: la bandeja del usuario muestra la notificación del mensaje por la frontera existente', opts, async (t) => {
  const { pool, notificaciones, mensajes } = await entorno(t);
  const s = await sembrarTenant(pool);
  await enviar(mensajes, s, s.comoCliente, 'hola');

  const propia = await notificaciones.listForUser(s.comoAliado, { limit: 10 });
  assert.equal(propia.length, 1);
  assert.equal(propia[0].tipo, 'MENSAJE_NUEVO');
  assert.equal((await notificaciones.listForUser(s.comoCliente, { limit: 10 })).length, 0);
});

test('PG: el índice impide dos notificaciones del mismo evento aunque se inserte directo', opts, async (t) => {
  const { pool } = await entorno(t);
  const s = await sembrarTenant(pool);
  const insertar = () =>
    pool.query("INSERT INTO notificacion (tenant_id, usuario_id, tipo, canal, payload, clave_evento) VALUES ($1, $2, 'MENSAJE_NUEVO', 'PUSH', '{}', 'evento-1')", [s.tenant, s.usuarioAliado]);
  await insertar();
  await assert.rejects(insertar, (err) => err.code === '23505' && err.constraint === 'ux_notificacion_clave_evento');
  // Las filas sin clave (ofertas de despacho antiguas) no quedan afectadas.
  await pool.query("INSERT INTO notificacion (tenant_id, usuario_id, tipo, canal, payload) VALUES ($1, $2, 'OTRO', 'PUSH', '{}')", [s.tenant, s.usuarioAliado]);
  await pool.query("INSERT INTO notificacion (tenant_id, usuario_id, tipo, canal, payload) VALUES ($1, $2, 'OTRO', 'PUSH', '{}')", [s.tenant, s.usuarioAliado]);
});
