// HU-M09-05 (SCRUM-884): los avisos del ciclo del servicio y su entrega por push contra PostgreSQL real, conectados como
// `mani_core_svc` (sin BYPASSRLS) para que las políticas RLS sí se evalúen. Se omite sin TEST_DATABASE_URL.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgQuoteRepository = require('../../../src/infrastructure/repositories/PgQuoteRepository');
const PgServiceExecutionRepository = require('../../../src/infrastructure/repositories/PgServiceExecutionRepository');
const PgServiceRequestRepository = require('../../../src/infrastructure/repositories/PgServiceRequestRepository');
const PgNotificacionRepository = require('../../../src/infrastructure/repositories/PgNotificacionRepository');
const CreateQuoteUseCase = require('../../../src/application/useCases/quotes/CreateQuoteUseCase');
const RespondQuoteUseCase = require('../../../src/application/useCases/quotes/RespondQuoteUseCase');
const ServiceExecutionUseCase = require('../../../src/application/useCases/services/ServiceExecutionUseCase');
const CancelServiceRequestUseCase = require('../../../src/application/useCases/requests/CancelServiceRequestUseCase');
const NotificarEventoServicioUseCase = require('../../../src/application/useCases/notifications/NotificarEventoServicioUseCase');
const MockPushProvider = require('../../../src/infrastructure/push/MockPushProvider');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };
const uuid = () => crypto.randomUUID();
const comoCore = (u) => `${u}${u.includes('?') ? '&' : '?'}options=-c%20role%3Dmani_core_svc`;

async function sembrarTenant(pool) {
  const s = { tenant: uuid(), usuarioCliente: uuid(), usuarioAliado: uuid(), cliente: uuid(), aliado: uuid(), solicitud: uuid() };
  const zona = uuid();
  const categoria = uuid();
  const sitio = uuid();
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [s.tenant, `t-${s.tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, estado) VALUES ($1, 'CIUDAD', 'Z', 'ACTIVO')", [zona]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado, flujo_operativo) VALUES ($1, $2, 'Plomeria', 'ACTIVO', 'COTIZACION_PREVIA')", [categoria, s.tenant]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVO')", [s.usuarioCliente, s.tenant, `${s.usuarioCliente}@t.test`]);
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [s.cliente, s.tenant, s.usuarioCliente]);
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1')", [sitio, s.tenant, s.cliente, zona]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'ALIADO', 'ACTIVO')", [s.usuarioAliado, s.tenant, `${s.usuarioAliado}@t.test`]);
  await pool.query("INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'Ana', 'VERIFICADO')", [s.aliado, s.tenant, s.usuarioAliado]);
  await pool.query(
    "INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, aliado_id, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ASIGNADA')",
    [s.solicitud, s.tenant, s.cliente, sitio, categoria, zona, s.aliado]
  );
  return {
    ...s,
    cliente: { user: { tenantId: s.tenant, userId: s.usuarioCliente, role: 'CLIENT' }, usuarioId: s.usuarioCliente },
    aliado: { user: { tenantId: s.tenant, userId: s.usuarioAliado, role: 'ALLY' }, usuarioId: s.usuarioAliado },
  };
}

async function entorno(t, { push = new MockPushProvider() } = {}) {
  const admin = new PgPoolFactory({ databaseUrl: url });
  const core = new PgPoolFactory({ databaseUrl: comoCore(url) });
  t.after(() => Promise.all([admin.close(), core.close()]));
  const notificador = new NotificarEventoServicioUseCase({
    notificacionRepository: new PgNotificacionRepository({ pgPoolFactory: core }),
    pushProvider: push,
    logger: () => {},
  });
  const quoteRepository = new PgQuoteRepository({ pgPoolFactory: core });
  return {
    pool: admin.getPool(),
    push,
    crearCotizacion: new CreateQuoteUseCase({ quoteRepository, notificador }),
    responderCotizacion: new RespondQuoteUseCase({ quoteRepository, notificador }),
    ejecucion: new ServiceExecutionUseCase({ serviceExecutionRepository: new PgServiceExecutionRepository({ pgPoolFactory: core }), notificador }),
    cancelar: new CancelServiceRequestUseCase({ serviceRequestRepository: new PgServiceRequestRepository({ pgPoolFactory: core }), notificador }),
  };
}

const bandeja = async (pool, tenant, usuario) =>
  (await pool.query('SELECT tipo, canal, payload FROM notificacion WHERE tenant_id = $1 AND usuario_id = $2 ORDER BY enviado_at, id', [tenant, usuario])).rows;
const emitir = (e, s, extra = {}) => e.crearCotizacion.execute({ user: s.aliado.user, solicitudId: s.solicitud, body: { valorManoObra: 100000, valorMateriales: 50000 }, correlationId: 'corr-884', ...extra });

test('PG C1: el aliado emite la cotización y el cliente recibe el aviso y el push', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrarTenant(e.pool);

  const cotizacion = await emitir(e, s);

  assert.equal('notificacionId' in cotizacion, false, 'la respuesta pública no filtra el id interno del aviso');
  const filas = await bandeja(e.pool, s.tenant, s.usuarioCliente);
  assert.deepEqual(filas.map((f) => [f.tipo, f.canal]), [['COTIZACION_RECIBIDA', 'PUSH']]);
  assert.deepEqual(filas[0].payload, { requestId: s.solicitud, cotizacionId: cotizacion.id, version: 1 });
  assert.equal(e.push.sentTo(s.tenant, s.usuarioCliente).length, 1);
  assert.equal(e.push.sentTo(s.tenant, s.usuarioCliente)[0].correlationId, 'corr-884');
  assert.equal((await bandeja(e.pool, s.tenant, s.usuarioAliado)).length, 0, 'quien emite no se notifica a sí mismo');
});

test('PG C1: el cliente responde la cotización y el aliado recibe el aviso y el push, para aceptar, rechazar y pedir ajuste', opts, async (t) => {
  for (const [accion, body] of [['ACEPTAR', {}], ['RECHAZAR', { motivo: 'Muy cara para el alcance' }], ['AJUSTAR', { comentario: 'Bajar materiales' }]]) {
    const e = await entorno(t);
    const s = await sembrarTenant(e.pool);
    const cot = await emitir(e, s);

    const respuesta = await e.responderCotizacion.execute({ user: s.cliente.user, cotizacionId: cot.id, accion, body, correlationId: 'corr-r' });

    assert.equal('notificacionId' in respuesta, false);
    const filas = await bandeja(e.pool, s.tenant, s.usuarioAliado);
    assert.deepEqual(filas.map((f) => f.tipo), ['RESPUESTA_COTIZACION'], accion);
    assert.equal(filas[0].payload.decision, accion);
    assert.equal(e.push.sentTo(s.tenant, s.usuarioAliado).length, 1, accion);
  }
});

test('PG C1: el aliado inicia y finaliza la ejecución y el cliente recibe cada aviso con su push', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrarTenant(e.pool);
  const cot = await emitir(e, s);
  await e.responderCotizacion.execute({ user: s.cliente.user, cotizacionId: cot.id, accion: 'ACEPTAR', body: {} });

  const inicio = await e.ejecucion.marcar({ user: s.aliado.user, solicitudId: s.solicitud, hito: 'INICIO' });
  const fin = await e.ejecucion.marcar({ user: s.aliado.user, solicitudId: s.solicitud, hito: 'FIN', correlationId: 'corr-fin' });

  assert.equal('notificacionId' in inicio || 'notificacionId' in fin, false);
  const filas = await bandeja(e.pool, s.tenant, s.usuarioCliente);
  assert.deepEqual(filas.map((f) => f.tipo), ['COTIZACION_RECIBIDA', 'EJECUCION_INICIADA', 'EJECUCION_FINALIZADA']);
  assert.equal(e.push.sentTo(s.tenant, s.usuarioCliente).length, 3);
});

test('PG C1: el cliente cancela y el aliado asignado recibe el aviso y el push; repetir la cancelación no repite nada', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrarTenant(e.pool);

  const primera = await e.cancelar.execute({ user: s.cliente.user, solicitudId: s.solicitud, body: { motivo: 'Ya no lo necesito' }, correlationId: 'corr-c' });
  const repetida = await e.cancelar.execute({ user: s.cliente.user, solicitudId: s.solicitud, body: {} });

  assert.equal(primera.cancelada, true);
  assert.equal(repetida.cancelada, false);
  assert.equal('notificacionId' in primera, false);
  const filas = await bandeja(e.pool, s.tenant, s.usuarioAliado);
  assert.deepEqual(filas.map((f) => [f.tipo, f.canal]), [['SOLICITUD_CANCELADA', 'PUSH']]);
  assert.equal(e.push.sentTo(s.tenant, s.usuarioAliado).length, 1, 'un solo push');
});

test('PG C2: si el push falla la operación se confirma y el aviso queda en la bandeja', opts, async (t) => {
  const caido = { name: 'caido', simulated: false, send: async () => { throw new Error('proveedor caído'); } };
  const e = await entorno(t, { push: caido });
  const s = await sembrarTenant(e.pool);

  const cot = await emitir(e, s);
  const resp = await e.responderCotizacion.execute({ user: s.cliente.user, cotizacionId: cot.id, accion: 'ACEPTAR', body: {} });
  const cancel = await e.cancelar.execute({ user: s.cliente.user, solicitudId: s.solicitud, body: {} });

  assert.equal(resp.solicitud.estado, 'ACEPTADA');
  assert.equal(cancel.solicitud.estado, 'CANCELADA');
  assert.equal((await e.pool.query('SELECT estado FROM solicitud WHERE id = $1', [s.solicitud])).rows[0].estado, 'CANCELADA');
  assert.equal((await bandeja(e.pool, s.tenant, s.usuarioCliente)).length, 1);
  assert.equal((await bandeja(e.pool, s.tenant, s.usuarioAliado)).length, 2, 'respuesta a la cotización y cancelación');
});

test('PG C2: una operación rechazada no deja aviso ni push', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrarTenant(e.pool);
  await emitir(e, s);

  await assert.rejects(() => emitir(e, s), (err) => err.code === 'MANI-COT-409P', 'ya hay una cotización pendiente');

  assert.equal((await bandeja(e.pool, s.tenant, s.usuarioCliente)).length, 1, 'solo el aviso de la primera');
  assert.equal(e.push.sent.length, 1);
});

test('PG C3: otro tenant no recibe ni dispara avisos; un aliado ajeno no puede emitir ni notificar', opts, async (t) => {
  const e = await entorno(t);
  const a = await sembrarTenant(e.pool);
  const b = await sembrarTenant(e.pool);
  await emitir(e, a);

  await assert.rejects(() => e.crearCotizacion.execute({ user: b.aliado.user, solicitudId: a.solicitud, body: { valorManoObra: 1, valorMateriales: 1 } }), (err) => err.statusCode === 404 || err.statusCode === 403);
  await assert.rejects(() => e.cancelar.execute({ user: b.cliente.user, solicitudId: a.solicitud, body: {} }), (err) => err.statusCode === 404);

  assert.equal((await e.pool.query('SELECT count(*)::int AS n FROM notificacion WHERE tenant_id = $1', [b.tenant])).rows[0].n, 0);
  assert.equal(e.push.sentTo(b.tenant, b.usuarioCliente).length + e.push.sentTo(b.tenant, b.usuarioAliado).length, 0);
  assert.equal((await bandeja(e.pool, a.tenant, a.usuarioCliente)).length, 1, 'el tenant A conserva solo su aviso');
});

test('PG: el índice de la cotización recibida impide el aviso duplicado aunque se inserte directo', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrarTenant(e.pool);
  const cot = await emitir(e, s);
  await assert.rejects(
    () => e.pool.query("INSERT INTO notificacion (tenant_id, usuario_id, tipo, canal, payload, clave_evento) VALUES ($1, $2, 'COTIZACION_RECIBIDA', 'PUSH', '{}', $3)", [s.tenant, s.usuarioCliente, `cotizacion-recibida:${cot.id}`]),
    (err) => err.code === '23505'
  );
});
