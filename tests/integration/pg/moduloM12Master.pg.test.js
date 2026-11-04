// Prueba maestra del módulo M-12 (SCRUM-895, 896, 900, 901): cada criterio C1-C3 se verifica por HTTP contra la app
// real (JWT -> authenticate -> caso de uso -> repositorio pg) y PostgreSQL real, conectado como `mani_core_svc` (sin
// BYPASSRLS) para que RLS y los disparadores de las migraciones 0032 y 0033 sí se evalúen. Se omite sin TEST_DATABASE_URL.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgComplaintRepository = require('../../../src/infrastructure/repositories/PgComplaintRepository');
const PgOperationalMetricsRepository = require('../../../src/infrastructure/repositories/PgOperationalMetricsRepository');
const PgTenantStatusRepository = require('../../../src/infrastructure/repositories/PgTenantStatusRepository');
const ComplaintsUseCase = require('../../../src/application/useCases/complaints/ComplaintsUseCase');
const OperationalMetricsUseCase = require('../../../src/application/useCases/metrics/OperationalMetricsUseCase');
const TenantStatusUseCase = require('../../../src/application/useCases/tenants/TenantStatusUseCase');
const { withTenantContext } = require('../../../src/infrastructure/db/withTenantContext');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };
const uuid = () => crypto.randomUUID();
const comoCore = (u) => `${u}${u.includes('?') ? '&' : '?'}options=-c%20role%3Dmani_core_svc`;

const token = ({ sub, tenant, role }) =>
  `Bearer ${jwt.sign({ sub, app_metadata: { tenant_id: tenant, user_role: role } }, config.supabaseJwtSecret, { algorithm: 'HS256', expiresIn: '1h' })}`;

async function sembrarTenant(pool) {
  const t = {
    id: uuid(), zona: uuid(), categoria: uuid(), categoriaSinTarifa: uuid(),
    cliente: { usuario: uuid(), id: uuid(), sitio: uuid() },
    otroCliente: { usuario: uuid(), id: uuid(), sitio: uuid() },
    aliado: { usuario: uuid(), id: uuid() },
    admin: { usuario: uuid() },
    plataforma: { usuario: uuid() },
    solicitud: uuid(), solicitudSinTarifa: uuid(), solicitudSinAliado: uuid(), solicitudOtroCliente: uuid(),
  };
  const q = (sql, params) => pool.query(sql, params);
  await q("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'Tenant', $2, 'ACTIVO')", [t.id, `t-${t.id}`]);
  await q("INSERT INTO zona (id, nivel, nombre, estado) VALUES ($1, 'CIUDAD', 'Z', 'ACTIVO')", [t.zona]);
  await q("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Plomeria', 'ACTIVO'), ($3, $2, 'Pintura', 'ACTIVO')", [t.categoria, t.id, t.categoriaSinTarifa]);
  const usuario = (id, rol) => q("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, $4, 'ACTIVO')", [id, t.id, `${id}@t.test`, rol]);
  await usuario(t.cliente.usuario, 'CLIENTE');
  await usuario(t.otroCliente.usuario, 'CLIENTE');
  await usuario(t.aliado.usuario, 'ALIADO');
  await usuario(t.admin.usuario, 'ADMIN_TENANT');
  await usuario(t.plataforma.usuario, 'ADMIN_PLATAFORMA');
  for (const c of [t.cliente, t.otroCliente]) {
    await q("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [c.id, t.id, c.usuario]);
    await q("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1')", [c.sitio, t.id, c.id, t.zona]);
  }
  await q("INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'Ana Aliada', 'VERIFICADO')", [t.aliado.id, t.id, t.aliado.usuario]);
  const solicitud = (id, cliente, categoria, aliado, estado) =>
    q('INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, aliado_id, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [id, t.id, cliente.id, cliente.sitio, categoria, t.zona, aliado, estado]);
  await solicitud(t.solicitud, t.cliente, t.categoria, t.aliado.id, 'COTIZANDO');
  await solicitud(t.solicitudSinTarifa, t.cliente, t.categoriaSinTarifa, t.aliado.id, 'FINALIZADA');
  await solicitud(t.solicitudSinAliado, t.cliente, t.categoria, null, 'PENDIENTE');
  await solicitud(t.solicitudOtroCliente, t.otroCliente, t.categoria, t.aliado.id, 'CANCELADA');
  return {
    ...t,
    jwt: {
      cliente: token({ sub: t.cliente.usuario, tenant: t.id, role: 'cliente' }),
      otroCliente: token({ sub: t.otroCliente.usuario, tenant: t.id, role: 'cliente' }),
      aliado: token({ sub: t.aliado.usuario, tenant: t.id, role: 'aliado' }),
      admin: token({ sub: t.admin.usuario, tenant: t.id, role: 'admin_tenant' }),
      plataforma: token({ sub: t.plataforma.usuario, tenant: t.id, role: 'admin_plataforma' }),
    },
  };
}

async function cotizar(pool, t, { solicitud = t.solicitud, total, creadaEn = new Date().toISOString(), estado = 'PENDIENTE', version = 1 }) {
  const id = uuid();
  await pool.query(
    `INSERT INTO cotizacion (id, tenant_id, solicitud_id, aliado_id, valor_mano_obra, valor_materiales, estado, version, created_at)
     VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8)`,
    [id, t.id, solicitud, t.aliado.id, total, estado, version, creadaEn]
  );
  return id;
}

/** Monta los casos de uso de M-12 con repositorios pg (como mani_core_svc); restaura al terminar. */
async function entorno(t) {
  const admin = new PgPoolFactory({ databaseUrl: url });
  const core = new PgPoolFactory({ databaseUrl: comoCore(url) });
  const originales = {};
  const nuevos = {
    complaintsUseCase: new ComplaintsUseCase({ complaintRepository: new PgComplaintRepository({ pgPoolFactory: core }) }),
    operationalMetricsUseCase: new OperationalMetricsUseCase({ metricsRepository: new PgOperationalMetricsRepository({ pgPoolFactory: core }) }),
    tenantStatusUseCase: new TenantStatusUseCase({ tenantStatusRepository: new PgTenantStatusRepository({ pgPoolFactory: core }) }),
  };
  for (const [k, v] of Object.entries(nuevos)) {
    originales[k] = container[k];
    container[k] = v;
  }
  t.after(async () => {
    Object.assign(container, originales);
    await Promise.all([admin.close(), core.close()]);
  });
  return { pool: admin.getPool(), corePool: core.getPool() };
}

const api = (metodo, ruta, jwtSesion, correlation = `corr-${crypto.randomUUID().slice(0, 8)}`) =>
  request(app)[metodo](`/api/v1${ruta}`).set('Authorization', jwtSesion).set('X-Correlation-ID', correlation);

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());

// =============================================================== SCRUM-895 · HU-M12-01
const quejaValida = { motivo: 'INCUMPLIMIENTO_DE_HORARIO', descripcion: 'El aliado llegó dos horas tarde sin avisar' };

test('895 C1: el cliente presenta una queja ligada a su servicio con motivo y queda ABIERTA con su primera transición', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);

  const r = await api('post', `/solicitudes/${a.solicitud}/quejas`, a.jwt.cliente, 'corr-895').send(quejaValida);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.queja.estado, 'ABIERTA');
  assert.equal(r.body.queja.solicitudId, a.solicitud);
  assert.equal(r.body.queja.motivo, 'INCUMPLIMIENTO_DE_HORARIO');
  assert.deepEqual(r.body.queja.historial.map((h) => [h.estadoAnterior, h.estadoNuevo, h.actor.rol]), [[null, 'ABIERTA', 'CLIENT']]);

  const fila = (await pool.query('SELECT * FROM queja WHERE id = $1', [r.body.queja.id])).rows[0];
  assert.equal(fila.tenant_id, a.id);
  assert.equal(fila.cliente_id, a.cliente.id);
  assert.equal(fila.creado_por, a.cliente.usuario);
  assert.equal(fila.correlation_id, 'corr-895');

  // Persistida: la vuelve a ver al consultar.
  const mias = await api('get', '/quejas/mias', a.jwt.cliente);
  assert.deepEqual(mias.body.quejas.map((q) => q.id), [r.body.queja.id]);
  // Sobre un servicio cancelado con aliado también se puede quejar el cliente dueño.
  const cancelada = await api('post', `/solicitudes/${a.solicitudOtroCliente}/quejas`, a.jwt.otroCliente).send(quejaValida);
  assert.equal(cancelada.status, 201);
});

test('895 C2: campos inválidos, servicio ajeno, sin aliado o una segunda queja abierta se rechazan sin crear filas', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  const contar = async () => (await pool.query('SELECT count(*)::int AS n FROM queja WHERE tenant_id = $1', [a.id])).rows[0].n;

  for (const body of [{}, { motivo: 'MOLESTIA', descripcion: quejaValida.descripcion }, { motivo: 'OTRO', descripcion: 'corta' }]) {
    const r = await api('post', `/solicitudes/${a.solicitud}/quejas`, a.jwt.cliente).send(body);
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'MANI-QJA-400');
  }
  // Servicio de otro cliente del mismo tenant o de otro tenant: responde como inexistente.
  for (const [jwtSesion, solicitud] of [[a.jwt.otroCliente, a.solicitud], [b.jwt.cliente, a.solicitud], [a.jwt.cliente, uuid()]]) {
    const r = await api('post', `/solicitudes/${solicitud}/quejas`, jwtSesion).send(quejaValida);
    assert.equal(r.status, 404);
    assert.equal(r.body.code, 'MANI-QJA-404S');
  }
  const sinAliado = await api('post', `/solicitudes/${a.solicitudSinAliado}/quejas`, a.jwt.cliente).send(quejaValida);
  assert.equal(sinAliado.status, 409);
  assert.equal(sinAliado.body.code, 'MANI-QJA-409S');
  assert.equal(await contar(), 0);

  assert.equal((await api('post', `/solicitudes/${a.solicitud}/quejas`, a.jwt.cliente).send(quejaValida)).status, 201);
  const segunda = await api('post', `/solicitudes/${a.solicitud}/quejas`, a.jwt.cliente).send(quejaValida);
  assert.equal(segunda.status, 409);
  assert.equal(segunda.body.code, 'MANI-QJA-409A');
  assert.equal(await contar(), 1);
});

test('895 C3: aliado y administrador no presentan quejas; cada cliente solo ve las suyas', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const queja = (await api('post', `/solicitudes/${a.solicitud}/quejas`, a.jwt.cliente).send(quejaValida)).body.queja;

  for (const jwtSesion of [a.jwt.aliado, a.jwt.admin]) {
    assert.equal((await api('post', `/solicitudes/${a.solicitud}/quejas`, jwtSesion).send(quejaValida)).status, 403);
  }
  assert.deepEqual((await api('get', '/quejas/mias', a.jwt.otroCliente)).body.quejas, []);
  const ajena = await api('get', `/quejas/${queja.id}`, a.jwt.otroCliente);
  assert.equal(ajena.status, 404);
  assert.equal((await api('get', `/quejas/${queja.id}`, a.jwt.cliente)).status, 200);
  assert.equal((await api('get', '/quejas/mias', a.jwt.aliado)).status, 403);
});

// =============================================================== SCRUM-896 · HU-M12-02
test('896 C1: el administrador cambia el estado y cada transición queda con actor, rol, fecha, nota y correlación', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const queja = (await api('post', `/solicitudes/${a.solicitud}/quejas`, a.jwt.cliente).send(quejaValida)).body.queja;

  const lista = await api('get', '/quejas?estado=ABIERTA', a.jwt.admin);
  assert.deepEqual(lista.body.quejas.map((q) => q.id), [queja.id]);

  const revision = await api('patch', `/quejas/${queja.id}/estado`, a.jwt.admin, 'corr-896-a').send({ estado: 'EN_REVISION' });
  assert.equal(revision.status, 200, JSON.stringify(revision.body));
  assert.equal(revision.body.queja.estado, 'EN_REVISION');
  const resuelta = await api('patch', `/quejas/${queja.id}/estado`, a.jwt.admin, 'corr-896-b').send({ estado: 'RESUELTA', nota: 'Se aplicó un descuento al cliente' });
  assert.equal(resuelta.status, 200);
  assert.equal(resuelta.body.queja.respuesta, 'Se aplicó un descuento al cliente');

  const historial = (await pool.query('SELECT * FROM queja_transicion WHERE queja_id = $1 ORDER BY created_at', [queja.id])).rows;
  assert.deepEqual(historial.map((h) => [h.estado_anterior, h.estado_nuevo, h.actor_rol, h.correlation_id]), [
    [null, 'ABIERTA', 'CLIENT', historial[0].correlation_id],
    ['ABIERTA', 'EN_REVISION', 'ADMIN', 'corr-896-a'],
    ['EN_REVISION', 'RESUELTA', 'ADMIN', 'corr-896-b'],
  ]);
  assert.equal(historial[2].actor_id, a.admin.usuario);
  assert.equal(historial[2].nota, 'Se aplicó un descuento al cliente');
  assert.ok(historial[2].created_at instanceof Date);
  // El cliente ve la respuesta y el historial; y le llega el aviso a su bandeja.
  const vista = await api('get', `/quejas/${queja.id}`, a.jwt.cliente);
  assert.equal(vista.body.queja.estado, 'RESUELTA');
  assert.equal(vista.body.queja.historial.length, 3);
  const avisos = (await pool.query("SELECT payload FROM notificacion WHERE usuario_id = $1 AND tipo = 'QUEJA_ACTUALIZADA'", [a.cliente.usuario])).rows;
  assert.deepEqual(avisos.map((x) => x.payload.estado).sort(), ['EN_REVISION', 'RESUELTA']);
});

test('896 C2: una transición inválida no modifica el estado ni deja registro, tampoco escribiendo directo en la base', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const queja = (await api('post', `/solicitudes/${a.solicitud}/quejas`, a.jwt.cliente).send(quejaValida)).body.queja;
  await api('patch', `/quejas/${queja.id}/estado`, a.jwt.admin).send({ estado: 'RECHAZADA', nota: 'No procede: el servicio se cumplió' });
  const estado = async () => (await pool.query('SELECT estado, respuesta FROM queja WHERE id = $1', [queja.id])).rows[0];
  const transiciones = async () => (await pool.query('SELECT count(*)::int AS n FROM queja_transicion WHERE queja_id = $1', [queja.id])).rows[0].n;
  const antes = { estado: await estado(), n: await transiciones() };

  for (const body of [{ estado: 'EN_REVISION' }, { estado: 'ABIERTA' }, { estado: 'RESUELTA', nota: 'Intento posterior' }]) {
    const r = await api('patch', `/quejas/${queja.id}/estado`, a.jwt.admin).send(body);
    assert.equal(r.status, 409, JSON.stringify(body));
    assert.equal(r.body.code, 'MANI-QJA-409T');
  }
  const sinNota = await api('patch', `/quejas/${queja.id}/estado`, a.jwt.admin).send({ estado: 'RESUELTA' });
  assert.equal(sinNota.status, 400);
  assert.deepEqual({ estado: await estado(), n: await transiciones() }, antes);

  // El disparador de la 0030 rechaza la transición aunque se salte la aplicación (incluso el dueño de la tabla).
  await assert.rejects(() => pool.query("UPDATE queja SET estado = 'ABIERTA' WHERE id = $1", [queja.id]), /MANI-QJA-409T/);
  await assert.rejects(() => pool.query("UPDATE queja SET descripcion = 'cambiada a mano' WHERE id = $1", [queja.id]), /MANI-QJA-409I/);
  await assert.rejects(() => pool.query('DELETE FROM queja_transicion WHERE queja_id = $1', [queja.id]), /inmutable/);
});

test('896 C3: ningún usuario administra quejas de otro tenant; el cliente no cambia estados ni por la base', opts, async (t) => {
  const { pool, corePool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  const queja = (await api('post', `/solicitudes/${a.solicitud}/quejas`, a.jwt.cliente).send(quejaValida)).body.queja;

  assert.deepEqual((await api('get', '/quejas', b.jwt.admin)).body.quejas, []);
  const ajena = await api('patch', `/quejas/${queja.id}/estado`, b.jwt.admin).send({ estado: 'EN_REVISION' });
  assert.equal(ajena.status, 404);
  assert.equal((await api('get', `/quejas/${queja.id}`, b.jwt.admin)).status, 404);
  assert.equal((await api('patch', `/quejas/${queja.id}/estado`, a.jwt.cliente).send({ estado: 'EN_REVISION' })).status, 403);
  assert.equal((await api('get', '/quejas', a.jwt.aliado)).status, 403);

  // RLS: con el rol del cliente (o con el admin de B) el UPDATE no alcanza la fila.
  for (const ctx of [{ tenantId: a.id, userId: a.cliente.usuario, role: 'cliente' }, { tenantId: b.id, userId: b.admin.usuario, role: 'admin_tenant' }]) {
    const { rowCount } = await withTenantContext(corePool, ctx, (c) => c.query("UPDATE queja SET estado = 'EN_REVISION' WHERE id = $1", [queja.id]));
    assert.equal(rowCount, 0, ctx.role);
  }
  assert.equal((await pool.query('SELECT estado FROM queja WHERE id = $1', [queja.id])).rows[0].estado, 'ABIERTA');
});

// =============================================================== SCRUM-900 · HU-M12-06
test('900 C1/C3: el administrador consulta los agregados de su tenant en el periodo, sin mezclar otro tenant', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  await cotizar(pool, a, { total: 100000, estado: 'ACEPTADA' });
  await cotizar(pool, a, { solicitud: a.solicitudSinTarifa, total: 50000, estado: 'RECHAZADA' });
  await cotizar(pool, b, { total: 1, estado: 'ACEPTADA' });
  await pool.query('INSERT INTO calificacion (tenant_id, solicitud_id, autor_id, destinatario_id, puntaje) VALUES ($1, $2, $3, $4, 4), ($1, $2, $4, $3, 5)', [a.id, a.solicitudSinTarifa, a.cliente.usuario, a.aliado.usuario]);
  await api('post', `/solicitudes/${a.solicitud}/quejas`, a.jwt.cliente).send(quejaValida);

  const r = await api('get', `/metricas/operativas?desde=${hoy()}&hasta=${hoy()}`, a.jwt.admin);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.solicitudes, {
    creadas: 4,
    porEstado: { CANCELADA: 1, COTIZANDO: 1, FINALIZADA: 1, PENDIENTE: 1 },
    finalizadas: 1,
    canceladas: 1,
    tasaCancelacion: 0.25,
  });
  assert.deepEqual(r.body.cotizaciones, { emitidas: 2, aceptadas: 1, tasaAceptacion: 0.5 });
  assert.deepEqual(r.body.calificaciones, { total: 2, promedio: 4.5 });
  assert.deepEqual(r.body.quejas, { registradas: 1, abiertas: 1, cerradas: 0 });
  assert.equal(r.body.aliadosConServicios, 1);
  assert.deepEqual(r.body.periodo, { desde: hoy(), hasta: hoy(), zonaHoraria: 'America/Bogota' });

  // B solo ve lo suyo (4 solicitudes sembradas y 1 cotización aceptada), nunca los datos de A.
  const deB = await api('get', `/metricas/operativas?desde=${hoy()}&hasta=${hoy()}`, b.jwt.admin);
  assert.deepEqual(deB.body.cotizaciones, { emitidas: 1, aceptadas: 1, tasaAceptacion: 1 });
  assert.deepEqual(deB.body.quejas, { registradas: 0, abiertas: 0, cerradas: 0 });
});

test('900 C2: un periodo sin datos devuelve ceros y tasas nulas reales; cliente y aliado reciben 403', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);

  const r = await api('get', '/metricas/operativas?desde=2020-01-01&hasta=2020-12-31', a.jwt.admin);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.solicitudes, { creadas: 0, porEstado: {}, finalizadas: 0, canceladas: 0, tasaCancelacion: null });
  assert.deepEqual(r.body.cotizaciones, { emitidas: 0, aceptadas: 0, tasaAceptacion: null });
  assert.deepEqual(r.body.pagos, { aprobados: 0, montoAprobado: 0 });
  assert.deepEqual(r.body.calificaciones, { total: 0, promedio: null });
  for (const jwtSesion of [a.jwt.cliente, a.jwt.aliado]) {
    assert.equal((await api('get', '/metricas/operativas?desde=2020-01-01&hasta=2020-01-02', jwtSesion)).status, 403);
  }
  assert.equal((await api('get', '/metricas/operativas?desde=2020-02-01&hasta=2020-01-01', a.jwt.admin)).status, 400);
});

// =============================================================== SCRUM-901 · HU-M12-07
test('901 C1: el administrador de plataforma suspende y reactiva un tenant con motivo; cada cambio queda registrado', opts, async (t) => {
  const { pool } = await entorno(t);
  const plataforma = await sembrarTenant(pool);
  const objetivo = await sembrarTenant(pool);

  const suspender = await api('patch', `/tenants/${objetivo.id}/estado`, plataforma.jwt.plataforma, 'corr-901').send({ estado: 'SUSPENDED', motivo: 'Mora de dos meses en el plan' });
  assert.equal(suspender.status, 200, JSON.stringify(suspender.body));
  assert.equal(suspender.body.tenant.status, 'SUSPENDED');
  assert.equal(suspender.body.cambio.estadoAnterior, 'ACTIVE');
  assert.equal((await pool.query('SELECT estado FROM tenant WHERE id = $1', [objetivo.id])).rows[0].estado, 'SUSPENDIDO');

  const reactivar = await api('patch', `/tenants/${objetivo.id}/estado`, plataforma.jwt.plataforma).send({ estado: 'ACTIVE', motivo: 'Pago del plan recibido' });
  assert.equal(reactivar.status, 200);

  const historial = await api('get', `/tenants/${objetivo.id}/estado/historial`, plataforma.jwt.plataforma);
  assert.deepEqual(historial.body.cambios.map((c) => [c.estadoAnterior, c.estadoNuevo]), [['SUSPENDED', 'ACTIVE'], ['ACTIVE', 'SUSPENDED']]);
  const fila = (await pool.query('SELECT * FROM tenant_estado_cambio WHERE tenant_id = $1 AND estado_nuevo = $2', [objetivo.id, 'SUSPENDIDO'])).rows[0];
  assert.equal(fila.actor_id, plataforma.plataforma.usuario);
  assert.equal(fila.actor_rol, 'PLATFORM_ADMIN');
  assert.equal(fila.actor_tenant_id, plataforma.id);
  assert.equal(fila.motivo, 'Mora de dos meses en el plan');
  assert.equal(fila.correlation_id, 'corr-901');

  const repetido = await api('patch', `/tenants/${objetivo.id}/estado`, plataforma.jwt.plataforma).send({ estado: 'ACTIVE', motivo: 'Pago del plan recibido' });
  assert.equal(repetido.status, 409);
  assert.equal(repetido.body.code, 'MANI-TEN-409');
  assert.equal((await api('patch', `/tenants/${uuid()}/estado`, plataforma.jwt.plataforma).send({ estado: 'ACTIVE', motivo: 'Motivo suficiente' })).status, 404);
  assert.equal((await api('patch', `/tenants/${objetivo.id}/estado`, plataforma.jwt.plataforma).send({ estado: 'SUSPENDED' })).status, 400);
});

test('901 C2/C3: admin_tenant, cliente y aliado no suspenden tenants ni ven el historial o la lista global; tampoco por la base', opts, async (t) => {
  const { pool, corePool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);

  for (const jwtSesion of [a.jwt.admin, a.jwt.cliente, a.jwt.aliado]) {
    assert.equal((await api('patch', `/tenants/${a.id}/estado`, jwtSesion).send({ estado: 'SUSPENDED', motivo: 'Intento sin permiso' })).status, 403);
    assert.equal((await api('patch', `/tenants/${b.id}/estado`, jwtSesion).send({ estado: 'SUSPENDED', motivo: 'Intento sin permiso' })).status, 403);
    assert.equal((await api('get', `/tenants/${a.id}/estado/historial`, jwtSesion)).status, 403);
    assert.equal((await api('get', '/tenants', jwtSesion)).status, 403);
  }
  // RLS (0031): con el rol admin_tenant el UPDATE no alcanza ni su propio tenant y el registro no admite filas.
  const ctx = { tenantId: a.id, userId: a.admin.usuario, role: 'admin_tenant' };
  const { rowCount } = await withTenantContext(corePool, ctx, (c) => c.query("UPDATE tenant SET estado = 'SUSPENDIDO' WHERE id = $1", [a.id]));
  assert.equal(rowCount, 0);
  await assert.rejects(
    () => withTenantContext(corePool, ctx, (c) => c.query("INSERT INTO tenant_estado_cambio (tenant_id, estado_anterior, estado_nuevo, motivo, actor_id, actor_rol, actor_tenant_id) VALUES ($1, 'ACTIVO', 'SUSPENDIDO', 'Intento directo', $2, 'ADMIN', $1)", [a.id, a.admin.usuario])),
    /row-level security/
  );
  // Ni el rol de servicio puede cambiar otra columna del tenant.
  await assert.rejects(
    () => withTenantContext(corePool, { ...ctx, role: 'admin_plataforma' }, (c) => c.query("UPDATE tenant SET nombre = 'Otro' WHERE id = $1", [a.id])),
    /permission denied/
  );
  assert.equal((await pool.query('SELECT estado FROM tenant WHERE id = $1', [a.id])).rows[0].estado, 'ACTIVO');
});

// =============================================================== Tokens inválidos (revisión de QA)
test('895/896/900/901 C3: un token expirado, alterado o firmado con otro secreto responde 401 en todos los endpoints y no escribe', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  const queja = (await api('post', `/solicitudes/${a.solicitud}/quejas`, a.jwt.cliente).send(quejaValida)).body.queja;
  const claims = (tenant, role) => ({ sub: a.admin.usuario, app_metadata: { tenant_id: tenant, user_role: role } });
  const firmar = (c, secreto = config.supabaseJwtSecret, opciones = { expiresIn: '1h' }) =>
    jwt.sign(c, secreto, { algorithm: 'HS256', ...opciones });

  const invalidos = (role) => {
    const expirado = firmar({ ...claims(a.id, role), exp: Math.floor(Date.now() / 1000) - 60 }, config.supabaseJwtSecret, {});
    // Alterado: el payload se cambia al tenant B conservando la firma del token de A.
    const [cabecera, , firma] = firmar(claims(a.id, role)).split('.');
    const payloadB = Buffer.from(JSON.stringify({ ...claims(b.id, role), exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    const otroSecreto = firmar(claims(b.id, role), 'secreto-que-no-es-el-del-ambiente-0123456789');
    return [expirado, `${cabecera}.${payloadB}.${firma}`, otroSecreto].map((x) => `Bearer ${x}`);
  };

  const llamadas = [
    ['cliente', 'post', `/solicitudes/${a.solicitudOtroCliente}/quejas`, quejaValida],
    ['cliente', 'get', '/quejas/mias'],
    ['admin_tenant', 'get', '/quejas'],
    ['admin_tenant', 'get', `/quejas/${queja.id}`],
    ['admin_tenant', 'patch', `/quejas/${queja.id}/estado`, { estado: 'EN_REVISION' }],
    ['admin_tenant', 'get', `/metricas/operativas?desde=${hoy()}&hasta=${hoy()}`],
    ['admin_plataforma', 'get', '/tenants'],
    ['admin_plataforma', 'patch', `/tenants/${b.id}/estado`, { estado: 'SUSPENDED', motivo: 'Intento con token inválido' }],
    ['admin_plataforma', 'get', `/tenants/${b.id}/estado/historial`],
  ];
  for (const [role, metodo, ruta, body] of llamadas) {
    for (const auth of invalidos(role)) {
      const r = await (body ? api(metodo, ruta, auth).send(body) : api(metodo, ruta, auth));
      assert.equal(r.status, 401, `${role} ${metodo} ${ruta}`);
    }
  }
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM queja WHERE tenant_id = ANY($1)', [[a.id, b.id]])).rows[0].n, 1);
  assert.equal((await pool.query('SELECT estado FROM queja WHERE id = $1', [queja.id])).rows[0].estado, 'ABIERTA');
  assert.equal((await pool.query('SELECT estado FROM tenant WHERE id = $1', [b.id])).rows[0].estado, 'ACTIVO');
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM tenant_estado_cambio WHERE tenant_id = $1', [b.id])).rows[0].n, 0);
});
