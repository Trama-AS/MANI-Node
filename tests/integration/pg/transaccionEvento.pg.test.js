// HU-M11-03 (SCRUM-889): el registro inmutable de transacciones contra PostgreSQL real, conectados como `mani_core_svc`
// (sin BYPASSRLS) para que las políticas RLS sí se evalúen. Se omite sin TEST_DATABASE_URL.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgPaymentRepository = require('../../../src/infrastructure/repositories/PgPaymentRepository');
const PgTransactionAuditRepository = require('../../../src/infrastructure/repositories/PgTransactionAuditRepository');
const { runInTenantContext } = require('../../../src/infrastructure/db/runInTenantContext');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };
const uuid = () => crypto.randomUUID();
const comoCore = (u) => `${u}${u.includes('?') ? '&' : '?'}options=-c%20role%3Dmani_core_svc`;

async function sembrarTenant(pool) {
  const s = { tenant: uuid(), usuario: uuid(), cliente: uuid(), solicitud: uuid(), cotizacion: uuid(), usuarioAdmin: uuid() };
  const zona = uuid();
  const categoria = uuid();
  const sitio = uuid();
  const usuarioAliado = uuid();
  const aliado = uuid();
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [s.tenant, `t-${s.tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, estado) VALUES ($1, 'CIUDAD', 'Z', 'ACTIVO')", [zona]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Plomeria', 'ACTIVO')", [categoria, s.tenant]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVO')", [s.usuario, s.tenant, `${s.usuario}@t.test`]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'ADMIN_TENANT', 'ACTIVO')", [s.usuarioAdmin, s.tenant, `${s.usuarioAdmin}@t.test`]);
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [s.cliente, s.tenant, s.usuario]);
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1')", [sitio, s.tenant, s.cliente, zona]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'ALIADO', 'ACTIVO')", [usuarioAliado, s.tenant, `${usuarioAliado}@t.test`]);
  await pool.query("INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'Ana', 'VERIFICADO')", [aliado, s.tenant, usuarioAliado]);
  await pool.query(
    "INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, aliado_id, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACEPTADA')",
    [s.solicitud, s.tenant, s.cliente, sitio, categoria, zona, aliado]
  );
  await pool.query(
    "INSERT INTO cotizacion (id, tenant_id, solicitud_id, aliado_id, valor_mano_obra, valor_materiales, estado) VALUES ($1, $2, $3, $4, 100000.50, 50000, 'ACEPTADA')",
    [s.cotizacion, s.tenant, s.solicitud, aliado]
  );
  return {
    ...s,
    comoCliente: { tenantId: s.tenant, userId: s.usuario, role: 'CLIENT' },
    comoAdmin: { tenantId: s.tenant, userId: s.usuarioAdmin, role: 'ADMIN' },
  };
}

async function entorno(t) {
  const admin = new PgPoolFactory({ databaseUrl: url });
  const core = new PgPoolFactory({ databaseUrl: comoCore(url) });
  t.after(() => Promise.all([admin.close(), core.close()]));
  return {
    pool: admin.getPool(),
    core,
    pagos: new PgPaymentRepository({ pgPoolFactory: core }),
    auditoria: new PgTransactionAuditRepository({ pgPoolFactory: core }),
  };
}

const pagoDe = (s, extra = {}) => ({
  cotizacionId: s.cotizacion, clienteId: s.cliente, monto: 150000.5, moneda: 'COP', estado: 'APROBADO', proveedor: 'mock',
  simulado: true, referenciaProveedor: `mock-pay-${uuid()}`, correlationId: 'corr-aud', claveIdempotencia: null, ...extra,
});

test('PG C1: cada pago deja un evento con actor, rol, hora de la base y correlación', opts, async (t) => {
  const { pool, pagos } = await entorno(t);
  const s = await sembrarTenant(pool);

  const { pago } = await pagos.registrar(s.comoCliente, pagoDe(s, { correlationId: 'corr-c1' }));

  const { rows } = await pool.query('SELECT * FROM transaccion_evento WHERE pago_id = $1', [pago.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tenant_id, s.tenant);
  assert.equal(rows[0].tipo, 'PAGO_REGISTRADO');
  assert.equal(rows[0].estado, 'APROBADO');
  assert.equal(Number(rows[0].monto), 150000.5);
  assert.equal(rows[0].actor_id, s.usuario, 'el actor sale de la sesión');
  assert.equal(rows[0].actor_rol, 'CLIENT');
  assert.equal(rows[0].correlation_id, 'corr-c1');
  assert.ok(Math.abs(Date.now() - rows[0].created_at.getTime()) < 60000, 'la hora es la de la base');
});

test('PG C1: un pago rechazado también queda registrado con su estado', opts, async (t) => {
  const { pool, pagos } = await entorno(t);
  const s = await sembrarTenant(pool);

  const { pago } = await pagos.registrar(s.comoCliente, pagoDe(s, { estado: 'RECHAZADO', motivo: 'simulado' }));

  const { rows } = await pool.query('SELECT estado FROM transaccion_evento WHERE pago_id = $1', [pago.id]);
  assert.deepEqual(rows.map((r) => r.estado), ['RECHAZADO']);
});

test('PG C2: un reintento con la misma clave no escribe otro evento', opts, async (t) => {
  const { pool, pagos } = await entorno(t);
  const s = await sembrarTenant(pool);
  const clave = uuid();

  const primero = await pagos.registrar(s.comoCliente, pagoDe(s, { claveIdempotencia: clave }));
  const reintento = await pagos.registrar(s.comoCliente, pagoDe(s, { claveIdempotencia: clave }));
  const enParalelo = await Promise.all([
    pagos.registrar(s.comoCliente, pagoDe(s, { claveIdempotencia: clave })),
    pagos.registrar(s.comoCliente, pagoDe(s, { claveIdempotencia: clave })),
  ]);

  assert.equal(primero.creado, true);
  assert.equal(reintento.creado, false);
  assert.ok(enParalelo.every((r) => r.creado === false && r.pago.id === primero.pago.id));
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM transaccion_evento WHERE tenant_id = $1', [s.tenant])).rows[0].n, 1);
});

test('PG C2: si el pago no se guarda (segundo cobro aprobado) tampoco queda evento', opts, async (t) => {
  const { pool, pagos } = await entorno(t);
  const s = await sembrarTenant(pool);
  await pagos.registrar(s.comoCliente, pagoDe(s, { claveIdempotencia: uuid() }));

  await assert.rejects(() => pagos.registrar(s.comoCliente, pagoDe(s, { claveIdempotencia: uuid() })), (err) => err.code === 'MANI-PAG-409A');

  assert.equal((await pool.query('SELECT count(*)::int AS n FROM transaccion_evento WHERE tenant_id = $1', [s.tenant])).rows[0].n, 1, 'atómico con el pago');
});

test('PG C3: el registro es inmutable aun para el dueño de la tabla y para el rol de servicio', opts, async (t) => {
  const { pool, core, pagos } = await entorno(t);
  const s = await sembrarTenant(pool);
  const { pago } = await pagos.registrar(s.comoCliente, pagoDe(s));

  // Dueño de la tabla (sin RLS ni permisos que lo frenen): lo frena el disparador.
  await assert.rejects(() => pool.query("UPDATE transaccion_evento SET estado = 'X' WHERE pago_id = $1", [pago.id]), /inmutable/);
  await assert.rejects(() => pool.query('DELETE FROM transaccion_evento WHERE pago_id = $1', [pago.id]), /inmutable/);
  await assert.rejects(() => pool.query('TRUNCATE transaccion_evento'), /inmutable/);

  // Rol de servicio: solo SELECT e INSERT.
  await assert.rejects(
    () => runInTenantContext(core, s.comoCliente, (c) => c.query("UPDATE transaccion_evento SET estado = 'X' WHERE pago_id = $1", [pago.id])),
    (err) => err.code === '42501'
  );
  await assert.rejects(
    () => runInTenantContext(core, s.comoCliente, (c) => c.query('DELETE FROM transaccion_evento WHERE pago_id = $1', [pago.id])),
    (err) => err.code === '42501'
  );
  assert.equal((await pool.query('SELECT estado FROM transaccion_evento WHERE pago_id = $1', [pago.id])).rows[0].estado, 'APROBADO');
});

test('PG C3: el cliente ve solo los eventos de sus pagos; otro cliente y otro tenant reciben 404', opts, async (t) => {
  const { pool, pagos, auditoria } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  const { pago } = await pagos.registrar(a.comoCliente, pagoDe(a));
  const noEncontrado = (err) => err.statusCode === 404 && err.code === 'MANI-AUD-404';

  const propios = await auditoria.listarPorPago(a.comoCliente, { pagoId: pago.id });
  assert.equal(propios.eventos.length, 1);
  assert.equal(propios.eventos[0].tipo, 'PAGO_REGISTRADO');
  assert.deepEqual(propios.eventos[0].actor, { id: a.usuario, rol: 'CLIENT' });

  await assert.rejects(() => auditoria.listarPorPago(b.comoCliente, { pagoId: pago.id }), noEncontrado);
  await assert.rejects(() => auditoria.listarPorPago(b.comoAdmin, { pagoId: pago.id }), noEncontrado);

  const otroUsuario = uuid();
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVO')", [otroUsuario, a.tenant, `${otroUsuario}@t.test`]);
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [uuid(), a.tenant, otroUsuario]);
  await assert.rejects(() => auditoria.listarPorPago({ tenantId: a.tenant, userId: otroUsuario, role: 'CLIENT' }, { pagoId: pago.id }), noEncontrado);
  await assert.rejects(() => auditoria.listarPorPago(a.comoCliente, { pagoId: uuid() }), noEncontrado);
});

test('PG C3: el administrador ve el registro de su tenant y nada de otro; el cursor no repite eventos', opts, async (t) => {
  const { pool, pagos, auditoria } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  const primero = await pagos.registrar(a.comoCliente, pagoDe(a, { estado: 'RECHAZADO' }));
  const segundo = await pagos.registrar(a.comoCliente, pagoDe(a, { claveIdempotencia: uuid() }));
  await pagos.registrar(b.comoCliente, pagoDe(b));

  const todos = (await auditoria.listar(a.comoAdmin, { limite: 50, despuesDe: null, pagoId: null })).eventos;
  assert.deepEqual(todos.map((e) => e.pagoId), [primero.pago.id, segundo.pago.id], 'del más antiguo al más reciente, solo del tenant A');

  const siguientes = (await auditoria.listar(a.comoAdmin, { limite: 50, despuesDe: todos[0].id, pagoId: null })).eventos;
  assert.deepEqual(siguientes.map((e) => e.id), [todos[1].id]);

  const porPago = (await auditoria.listar(a.comoAdmin, { limite: 50, despuesDe: null, pagoId: primero.pago.id })).eventos;
  assert.equal(porPago.length, 1);

  const delOtro = (await auditoria.listar(b.comoAdmin, { limite: 50, despuesDe: null, pagoId: null })).eventos;
  assert.equal(delOtro.length, 1);
  await assert.rejects(
    () => auditoria.listar(b.comoAdmin, { limite: 50, despuesDe: todos[0].id, pagoId: null }),
    (err) => err.statusCode === 400 && err.code === 'MANI-AUD-400',
    'un cursor de otro tenant no existe'
  );
});

test('PG: RLS aísla los eventos por tenant aunque la consulta no filtre', opts, async (t) => {
  const { pool, core, pagos } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  const { pago } = await pagos.registrar(a.comoCliente, pagoDe(a));

  const visibles = await runInTenantContext(core, b.comoAdmin, (c) => c.query('SELECT count(*)::int AS n FROM transaccion_evento'));
  assert.equal(visibles.rows[0].n, 0);
  await assert.rejects(
    () => runInTenantContext(core, b.comoAdmin, (c) =>
      c.query("INSERT INTO transaccion_evento (tenant_id, pago_id, tipo, estado, monto, moneda, actor_id, actor_rol) VALUES ($1, $2, 'OTRO', 'X', 1, 'COP', $3, 'ADMIN')", [a.tenant, pago.id, b.usuarioAdmin])),
    (err) => err.code === '42501',
    'no se puede escribir un evento en otro tenant'
  );
});
