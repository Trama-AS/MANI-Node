// SCRUM-889: el evento `PagoRegistrado` en el outbox y su relay contra PostgreSQL real, conectados como `mani_core_svc`
// (sin BYPASSRLS). Se omite sin TEST_DATABASE_URL; en CI corre siempre.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgPaymentRepository = require('../../../src/infrastructure/repositories/PgPaymentRepository');
const OutboxRelay = require('../../../src/infrastructure/events/OutboxRelay');
const { runInTenantContext } = require('../../../src/infrastructure/db/runInTenantContext');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };
const uuid = () => crypto.randomUUID();
const comoCore = (u) => `${u}${u.includes('?') ? '&' : '?'}options=-c%20role%3Dmani_core_svc`;
const mudo = { error() {}, warn() {}, log() {} };

async function entorno(t) {
  const admin = new PgPoolFactory({ databaseUrl: url });
  const core = new PgPoolFactory({ databaseUrl: comoCore(url), max: 10 });
  t.after(() => Promise.all([admin.close(), core.close()]));
  return { pool: admin.getPool(), core, pagos: new PgPaymentRepository({ pgPoolFactory: core }) };
}

async function sembrar(pool) {
  const tenant = uuid();
  const [zona, categoria, sitio, solicitud, cotizacion, usuario, usuarioAliado, cliente, aliado] = Array.from({ length: 9 }, uuid);
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [tenant, `t-${tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, estado) VALUES ($1, 'CIUDAD', 'Z', 'ACTIVO')", [zona]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Plomeria', 'ACTIVO')", [categoria, tenant]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVO')", [usuario, tenant, `${usuario}@t.test`]);
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [cliente, tenant, usuario]);
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1')", [sitio, tenant, cliente, zona]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'ALIADO', 'ACTIVO')", [usuarioAliado, tenant, `${usuarioAliado}@t.test`]);
  await pool.query("INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'Ana', 'VERIFICADO')", [aliado, tenant, usuarioAliado]);
  await pool.query("INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, aliado_id, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACEPTADA')", [solicitud, tenant, cliente, sitio, categoria, zona, aliado]);
  await pool.query("INSERT INTO cotizacion (id, tenant_id, solicitud_id, aliado_id, valor_mano_obra, valor_materiales, estado) VALUES ($1, $2, $3, $4, 100000.50, 50000, 'ACEPTADA')", [cotizacion, tenant, solicitud, aliado]);
  return { tenant, solicitud, cotizacion, cliente, aliado, ctx: { tenantId: tenant, userId: usuario, role: 'CLIENT' } };
}

const pago = (s, extra = {}) => ({
  cotizacionId: s.cotizacion, clienteId: s.cliente, monto: 150000.5, moneda: 'COP', estado: 'APROBADO', proveedor: 'mock',
  simulado: true, referenciaProveedor: `mock-${uuid()}`, correlationId: uuid(), claveIdempotencia: null, ...extra,
});
const eventos = async (pool, tenant) => (await pool.query('SELECT * FROM outbox_evento WHERE tenant_id = $1 ORDER BY fecha_ocurrencia', [tenant])).rows;

test('PG outbox: un pago deja su evento PagoRegistrado en la misma transacción, con el sobre y los ids del negocio', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrar(e.pool);
  const corr = uuid();
  const { pago: p } = await e.pagos.registrar(s.ctx, pago(s, { correlationId: corr }));

  const [ev, ...resto] = await eventos(e.pool, s.tenant);
  assert.equal(resto.length, 0);
  assert.deepEqual([ev.tipo_evento, ev.version_evento, ev.topico], ['PagoRegistrado', 1, 'mani.pago.pago-registrado.v1']);
  assert.equal(ev.clave_particion, s.solicitud, 'clave de partición = la solicitud');
  assert.equal(ev.id_agregado, p.id);
  assert.equal(ev.correlation_id, corr);
  assert.deepEqual(ev.payload, {
    id_pago: p.id, id_solicitud: s.solicitud, id_cotizacion: s.cotizacion, id_cliente: s.cliente, id_aliado: s.aliado,
    estado: 'APROBADO', monto: 150000.5, moneda: 'COP', proveedor: 'mock', simulado: true,
  });
});

test('PG outbox: un pago rechazado también publica su evento (con estado RECHAZADO); un correlation_id que no es UUID se reemplaza', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrar(e.pool);
  await e.pagos.registrar(s.ctx, pago(s, { estado: 'RECHAZADO', motivo: 'sin fondos', correlationId: 'node-1791318617328' }));
  const [ev] = await eventos(e.pool, s.tenant);
  assert.equal(ev.payload.estado, 'RECHAZADO');
  assert.match(ev.correlation_id, /^[0-9a-f-]{36}$/);
});

test('PG outbox: reintentar con la misma clave no duplica el evento; un segundo cobro aprobado no deja evento', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrar(e.pool);
  const clave = uuid();
  await e.pagos.registrar(s.ctx, pago(s, { claveIdempotencia: clave }));
  await e.pagos.registrar(s.ctx, pago(s, { claveIdempotencia: clave })).catch(() => {});
  assert.equal((await eventos(e.pool, s.tenant)).length, 1);

  await assert.rejects(e.pagos.registrar(s.ctx, pago(s, { claveIdempotencia: uuid() })), (err) => err.code === 'MANI-PAG-409A');
  assert.equal((await eventos(e.pool, s.tenant)).length, 1, 'el pago no se guardó, así que tampoco su evento');
});

test('PG outbox: si la transacción del pago se revierte, el evento tampoco queda', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrar(e.pool);
  await assert.rejects(
    runInTenantContext(e.core, s.ctx, async (client) => {
      const { escribirEnOutbox } = require('../../../src/infrastructure/events/outboxEventos');
      await escribirEnOutbox(client, s.ctx, {
        id: uuid(), tipoEvento: 'PagoRegistrado', versionEvento: 1, topico: 't', clavePart: s.solicitud, idAgregado: uuid(), correlationId: uuid(), payload: {},
      });
      throw new Error('falla posterior');
    }),
    /falla posterior/
  );
  assert.equal((await eventos(e.pool, s.tenant)).length, 0);
});

test('PG outbox RLS: otro tenant no ve los eventos; sin contexto mani_core_svc no ve nada; no puede actualizar ni borrar', opts, async (t) => {
  const e = await entorno(t);
  const a = await sembrar(e.pool);
  const b = await sembrar(e.pool);
  await e.pagos.registrar(a.ctx, pago(a));

  const vistoPorB = await runInTenantContext(e.core, b.ctx, (c) => c.query('SELECT count(*)::int AS n FROM outbox_evento'));
  assert.equal(vistoPorB.rows[0].n, 0);
  const vistoPorA = await runInTenantContext(e.core, a.ctx, (c) => c.query('SELECT count(*)::int AS n FROM outbox_evento'));
  assert.equal(vistoPorA.rows[0].n, 1);
  assert.equal((await e.core.getPool().query('SELECT count(*)::int AS n FROM outbox_evento')).rows[0].n, 0, 'sin contexto, la política no devuelve filas');
  await assert.rejects(e.core.getPool().query('UPDATE outbox_evento SET intentos = 99'), (err) => err.code === '42501');
  await assert.rejects(e.core.getPool().query('DELETE FROM outbox_evento'), (err) => err.code === '42501');
  // B no puede escribir un evento a nombre de A.
  await assert.rejects(
    runInTenantContext(e.core, b.ctx, (c) => c.query(
      `INSERT INTO outbox_evento (id, tenant_id, tipo_evento, version_evento, topico, clave_particion, id_agregado, correlation_id, payload)
       VALUES ($1, $2, 'X', 1, 't', $3, $4, $5, '{}')`, [uuid(), a.tenant, uuid(), uuid(), uuid()])),
    (err) => err.code === '42501'
  );
});

// Otros archivos de prueba también registran pagos en esta base y el relay publica TODOS los pendientes (así debe ser),
// por eso estas pruebas miran solo sus propios eventos y no cuentan ni borran los ajenos.
const vaciar = async (relay) => {
  for (let i = 0; i < 50; i++) if ((await relay.tick()) === 0) return;
};
const pendientesDe = async (pool, tenants) =>
  (await pool.query('SELECT count(*)::int AS n FROM outbox_evento WHERE tenant_id = ANY($1::uuid[]) AND fecha_publicacion IS NULL', [tenants])).rows[0].n;

test('PG relay: publica los pendientes de todos los tenants con el sobre completo, los marca y no los repite', opts, async (t) => {
  const e = await entorno(t);
  const a = await sembrar(e.pool);
  const b = await sembrar(e.pool);
  await e.pagos.registrar(a.ctx, pago(a));
  await e.pagos.registrar(b.ctx, pago(b));

  const enviados = [];
  const relay = new OutboxRelay({ pgPoolFactory: e.core, publisher: { publish: async (m) => enviados.push(...m) }, logger: mudo });
  await vaciar(relay);

  const mios = enviados.filter((m) => [a.tenant, b.tenant].includes(JSON.parse(m.value).tenant_id));
  assert.equal(mios.length, 2, 'los eventos de los dos tenants salen, cada uno una vez');
  assert.deepEqual(new Set(mios.map((m) => JSON.parse(m.value).tenant_id)), new Set([a.tenant, b.tenant]));
  assert.ok(mios.every((m) => m.topic === 'mani.pago.pago-registrado.v1'));
  const sobre = JSON.parse(mios[0].value);
  assert.deepEqual(Object.keys(sobre).sort(), ['correlation_id', 'data', 'event_id', 'event_type', 'event_version', 'occurred_at', 'partition_key', 'tenant_id']);
  assert.equal(await pendientesDe(e.pool, [a.tenant, b.tenant]), 0);

  // Solo los eventos propios: otros archivos de prueba registran pagos a la vez y el relay publica los de todos, así que
  // contar todo lo enviado haría fallar la prueba al azar (56 !== 55 en CI).
  const propios = () => enviados.filter((m) => [a.tenant, b.tenant].includes(JSON.parse(m.value).tenant_id)).length;
  const antes = propios();
  await vaciar(relay);
  assert.equal(propios(), antes, 'lo ya publicado no sale de nuevo');
});

test('PG relay: si Kafka falla el evento sigue pendiente, cuenta el intento y el siguiente intento lo publica', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrar(e.pool);
  await e.pagos.registrar(s.ctx, pago(s));

  let caido = true;
  const enviados = [];
  const relay = new OutboxRelay({
    pgPoolFactory: e.core,
    publisher: { publish: async (m) => { if (caido) throw new Error('broker caído'); enviados.push(...m); } },
    logger: mudo,
  });
  assert.equal(await relay.tick(), 0);
  let [ev] = await eventos(e.pool, s.tenant);
  assert.equal(ev.fecha_publicacion, null);
  assert.ok(ev.intentos >= 1);
  assert.equal(ev.ultimo_error, 'broker caído');

  caido = false;
  await vaciar(relay);
  [ev] = await eventos(e.pool, s.tenant);
  assert.ok(ev.fecha_publicacion);
  assert.equal(ev.ultimo_error, null);
  assert.equal(enviados.filter((m) => m.eventId === ev.id).length, 1);
});

test('PG relay: dos relays a la vez no publican el mismo evento (SKIP LOCKED)', opts, async (t) => {
  const e = await entorno(t);
  const tenants = [];
  for (let i = 0; i < 4; i++) {
    const s = await sembrar(e.pool);
    await e.pagos.registrar(s.ctx, pago(s));
    tenants.push(s.tenant);
  }
  const enviados = [];
  const lento = { publish: async (m) => { await new Promise((r) => setTimeout(r, 80)); enviados.push(...m.map((x) => x.eventId)); } };
  const r1 = new OutboxRelay({ pgPoolFactory: e.core, publisher: lento, batchSize: 2, logger: mudo });
  const r2 = new OutboxRelay({ pgPoolFactory: e.core, publisher: lento, batchSize: 2, logger: mudo });
  for (let i = 0; i < 30 && (await pendientesDe(e.pool, tenants)) > 0; i++) await Promise.all([r1.tick(), r2.tick()]);

  assert.equal(await pendientesDe(e.pool, tenants), 0);
  assert.equal(new Set(enviados).size, enviados.length, 'ningún evento salió dos veces');
});

test('PG outbox: la restricción de un evento por agregado y tipo existe', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrar(e.pool);
  const fila = [uuid(), s.tenant, 'PagoRegistrado', 1, 't', s.solicitud, s.cotizacion, uuid(), '{}'];
  const sql = `INSERT INTO outbox_evento (id, tenant_id, tipo_evento, version_evento, topico, clave_particion, id_agregado, correlation_id, payload)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`;
  await e.pool.query(sql, fila);
  await assert.rejects(e.pool.query(sql, [uuid(), ...fila.slice(1)]), (err) => err.code === '23505');
});
