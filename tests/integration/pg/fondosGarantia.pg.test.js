// SCRUM-891 a 894: retención en garantía, liberación, liquidación y cobros del aliado contra PostgreSQL real, conectados
// como `mani_core_svc` (sin BYPASSRLS). Se omite sin TEST_DATABASE_URL; en CI corre siempre.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgPaymentRepository = require('../../../src/infrastructure/repositories/PgPaymentRepository');
const PgServiceExecutionRepository = require('../../../src/infrastructure/repositories/PgServiceExecutionRepository');
const PgFondosRepository = require('../../../src/infrastructure/repositories/PgFondosRepository');
const FundsUseCase = require('../../../src/application/useCases/payments/FundsUseCase');
const { REGLAS_POR_OMISION } = require('../../../src/domain/rules/tenantRulesDefaults');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };
const uuid = () => crypto.randomUUID();
const comoCore = (u) => `${u}${u.includes('?') ? '&' : '?'}options=-c%20role%3Dmani_core_svc`;

async function entorno(t) {
  const admin = new PgPoolFactory({ databaseUrl: url });
  const core = new PgPoolFactory({ databaseUrl: comoCore(url) });
  t.after(() => Promise.all([admin.close(), core.close()]));
  const fondos = new PgFondosRepository({ pgPoolFactory: core });
  return {
    pool: admin.getPool(),
    corePool: core.getPool(),
    pagos: new PgPaymentRepository({ pgPoolFactory: core }),
    ejecucion: new PgServiceExecutionRepository({ pgPoolFactory: core }),
    fondos,
    funds: new FundsUseCase({ fondosRepository: fondos }),
  };
}

// Guarda una versión nueva de las reglas del tenant, como lo hace SCRUM-1366: la anterior pasa a HISTORICA.
async function guardarRegla(pool, s, cambios) {
  const { rows } = await pool.query('SELECT coalesce(max(version), 0) + 1 AS version FROM regla_tenant WHERE tenant_id = $1', [s.tenant]);
  await pool.query("UPDATE regla_tenant SET estado = 'HISTORICA' WHERE tenant_id = $1 AND estado = 'VIGENTE'", [s.tenant]);
  await pool.query(
    "INSERT INTO regla_tenant (tenant_id, version, reglas, estado, creado_por, actor_rol) VALUES ($1, $2, $3, 'VIGENTE', $4, 'ADMIN')",
    [s.tenant, rows[0].version, JSON.stringify({ ...REGLAS_POR_OMISION, ...cambios }), s.admin.userId]
  );
}

async function usuario(pool, tenant, rol) {
  const id = uuid();
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, $4, 'ACTIVO')", [id, tenant, `${id}@t.test`, rol]);
  return id;
}

async function aliadoDe(pool, tenant) {
  const u = await usuario(pool, tenant, 'ALIADO');
  const id = uuid();
  await pool.query("INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'Ana', 'VERIFICADO')", [id, tenant, u]);
  return { id, ctx: { tenantId: tenant, userId: u, role: 'ALLY' } };
}

async function clienteDe(pool, tenant) {
  const u = await usuario(pool, tenant, 'CLIENTE');
  const id = uuid();
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [id, tenant, u]);
  return { id, ctx: { tenantId: tenant, userId: u, role: 'CLIENT' } };
}

/** Tenant con un cliente, un aliado asignado y una solicitud ACEPTADA con su cotización aceptada de 150000.50. */
async function sembrar(pool) {
  const tenant = uuid();
  const [zona, categoria, sitio, solicitud, cotizacion] = [uuid(), uuid(), uuid(), uuid(), uuid()];
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [tenant, `t-${tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, estado) VALUES ($1, 'CIUDAD', 'Z', 'ACTIVO')", [zona]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Plomeria', 'ACTIVO')", [categoria, tenant]);
  const cliente = await clienteDe(pool, tenant);
  const aliado = await aliadoDe(pool, tenant);
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1')", [sitio, tenant, cliente.id, zona]);
  await pool.query(
    "INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, aliado_id, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACEPTADA')",
    [solicitud, tenant, cliente.id, sitio, categoria, zona, aliado.id]
  );
  await pool.query(
    "INSERT INTO cotizacion (id, tenant_id, solicitud_id, aliado_id, valor_mano_obra, valor_materiales, estado) VALUES ($1, $2, $3, $4, 100000.50, 50000, 'ACEPTADA')",
    [cotizacion, tenant, solicitud, aliado.id]
  );
  const admin = { tenantId: tenant, userId: await usuario(pool, tenant, 'ADMIN_TENANT'), role: 'ADMIN' };
  return { tenant, solicitud, cotizacion, cliente, aliado, admin };
}

const pago = (s, extra = {}) => ({
  cotizacionId: s.cotizacion, clienteId: s.cliente.id, monto: 150000.5, moneda: 'COP', estado: 'APROBADO', proveedor: 'mock',
  simulado: true, referenciaProveedor: `mock-${uuid()}`, correlationId: 'corr-fondos', claveIdempotencia: null, ...extra,
});
const filas = async (pool, sql, params) => (await pool.query(sql, params)).rows;
const iniciar = (e, s) => e.ejecucion.marcar(s.aliado.ctx, { solicitudId: s.solicitud, hito: 'INICIO' });
const finalizar = (e, s) => e.ejecucion.marcar(s.aliado.ctx, { solicitudId: s.solicitud, hito: 'FIN' });
const eventos = async (pool, pagoId) => (await filas(pool, 'SELECT tipo FROM transaccion_evento WHERE pago_id = $1 ORDER BY tipo', [pagoId])).map((r) => r.tipo);

test('PG 891: un pago aprobado retiene su monto (simulado, RETENIDA); reintentar no duplica la retención', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrar(e.pool);
  const clave = uuid();
  const { pago: p } = await e.pagos.registrar(s.cliente.ctx, pago(s, { claveIdempotencia: clave }));
  await e.pagos.registrar(s.cliente.ctx, pago(s, { claveIdempotencia: clave })).catch(() => {});

  const ret = await e.funds.retencion({ user: s.cliente.ctx, pagoId: p.id });
  assert.deepEqual([ret.estado, ret.monto, ret.moneda, ret.simulada, ret.liberadaEn], ['RETENIDA', 150000.5, 'COP', true, null]);
  assert.equal((await filas(e.pool, 'SELECT 1 FROM retencion_fondos WHERE pago_id = $1', [p.id])).length, 1);
});

test('PG 891 C2: un pago rechazado o pendiente no genera retención', opts, async (t) => {
  const e = await entorno(t);
  for (const estado of ['RECHAZADO', 'PENDIENTE']) {
    const s = await sembrar(e.pool);
    const { pago: p } = await e.pagos.registrar(s.cliente.ctx, pago(s, { estado, motivo: 'x' }));
    assert.equal((await filas(e.pool, 'SELECT 1 FROM retencion_fondos WHERE pago_id = $1', [p.id])).length, 0, estado);
    await assert.rejects(e.funds.retencion({ user: s.cliente.ctx, pagoId: p.id }), (err) => err.code === 'MANI-FON-404' && err.statusCode === 404);
  }
});

test('PG 892: la retención sigue RETENIDA durante la ejecución y se libera al finalizar el servicio', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrar(e.pool);
  const { pago: p } = await e.pagos.registrar(s.cliente.ctx, pago(s));

  await iniciar(e, s);
  assert.equal((await e.funds.retencion({ user: s.cliente.ctx, pagoId: p.id })).estado, 'RETENIDA', 'en ejecución no se libera');
  assert.equal((await filas(e.pool, 'SELECT 1 FROM liquidacion WHERE pago_id = $1', [p.id])).length, 0);

  await finalizar(e, s);
  const ret = await e.funds.retencion({ user: s.cliente.ctx, pagoId: p.id });
  assert.equal(ret.estado, 'LIBERADA');
  assert.ok(ret.liberadaEn);
  assert.deepEqual(await eventos(e.pool, p.id), ['PAGO_REGISTRADO'], 'el registro de 889 conserva un evento por pago');
});

test('PG 892: finalizar sin pago no libera ni liquida nada y no falla; finalizar dos veces no duplica', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrar(e.pool);
  await iniciar(e, s);
  await finalizar(e, s);
  assert.equal((await filas(e.pool, 'SELECT 1 FROM liquidacion WHERE solicitud_id = $1', [s.solicitud])).length, 0);

  const s2 = await sembrar(e.pool);
  await e.pagos.registrar(s2.cliente.ctx, pago(s2));
  await iniciar(e, s2);
  await finalizar(e, s2);
  await assert.rejects(finalizar(e, s2), (err) => err.code === 'MANI-EJE-409F');
  assert.equal((await filas(e.pool, 'SELECT 1 FROM liquidacion WHERE solicitud_id = $1', [s2.solicitud])).length, 1);
});

test('PG 893: la liquidación descuenta el 10 % por defecto; bruto = comisión + neto', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrar(e.pool);
  await e.pagos.registrar(s.cliente.ctx, pago(s));
  await iniciar(e, s);
  await finalizar(e, s);

  const { cobros } = await e.funds.cobrosDelAliado({ user: s.aliado.ctx });
  assert.equal(cobros.length, 1);
  assert.deepEqual(cobros[0].liquidacion, { id: cobros[0].liquidacion.id, montoBruto: 150000.5, porcentajeComision: 10, comision: 15000.05, montoNeto: 135000.45 });
  assert.equal(cobros[0].estado, 'LIBERADA');
  assert.equal(cobros[0].simulada, true);
});

test('PG 893: la liquidación usa la regla vigente del tenant; cambiarla no altera liquidaciones ya generadas', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrar(e.pool);
  assert.deepEqual(await e.funds.obtenerComision({ user: s.admin }), { porcentaje: 10, porDefecto: true });
  await guardarRegla(e.pool, s, { comision: { porcentaje: 25 } });
  assert.deepEqual(await e.funds.obtenerComision({ user: s.admin }), { porcentaje: 25, porDefecto: false });

  await e.pagos.registrar(s.cliente.ctx, pago(s));
  await iniciar(e, s);
  await finalizar(e, s);
  await guardarRegla(e.pool, s, { comision: { porcentaje: 5 } });
  assert.equal((await e.funds.obtenerComision({ user: s.admin })).porcentaje, 5);
  const { cobros } = await e.funds.cobrosDelAliado({ user: s.aliado.ctx });
  assert.equal(cobros[0].liquidacion.porcentajeComision, 25);
  assert.equal(cobros[0].liquidacion.comision, 37500.13);
  assert.equal(cobros[0].liquidacion.montoNeto, 112500.37);
});

test('PG 893: la regla de otro tenant no cambia la comisión; una regla en 0 % no descuenta nada', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrar(e.pool);
  const otro = await sembrar(e.pool);
  await guardarRegla(e.pool, otro, { comision: { porcentaje: 30 } });
  assert.deepEqual(await e.funds.obtenerComision({ user: s.admin }), { porcentaje: 10, porDefecto: true });

  await guardarRegla(e.pool, s, { comision: { porcentaje: 0 } });
  await e.pagos.registrar(s.cliente.ctx, pago(s));
  await iniciar(e, s);
  await finalizar(e, s);
  const { cobros } = await e.funds.cobrosDelAliado({ user: s.aliado.ctx });
  assert.equal(cobros[0].liquidacion.comision, 0);
  assert.equal(cobros[0].liquidacion.montoNeto, 150000.5);
});

test('PG 893 C2: una comisión inválida en la regla bloquea la liquidación y la retención sigue RETENIDA', opts, async (t) => {
  const e = await entorno(t);
  for (const invalida of [{ comision: { porcentaje: 30.01 } }, { comision: { porcentaje: -1 } }, { comision: { porcentaje: 'abc' } }, { comision: {} }, { comision: null }]) {
    const s = await sembrar(e.pool);
    await guardarRegla(e.pool, s, invalida);
    const { pago: p } = await e.pagos.registrar(s.cliente.ctx, pago(s));
    await iniciar(e, s);
    await finalizar(e, s);
    assert.equal((await e.funds.retencion({ user: s.cliente.ctx, pagoId: p.id })).estado, 'RETENIDA', JSON.stringify(invalida));
    assert.equal((await filas(e.pool, 'SELECT 1 FROM liquidacion WHERE pago_id = $1', [p.id])).length, 0, JSON.stringify(invalida));
  }
});

test('PG 893 C3: solo el administrador consulta la comisión; cliente y aliado reciben 403', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrar(e.pool);
  for (const user of [s.cliente.ctx, s.aliado.ctx]) {
    await assert.rejects(e.funds.obtenerComision({ user }), (err) => err.statusCode === 403);
  }
});

test('PG 894: el aliado ve solo sus cobros; sin movimientos la lista está vacía; otros aliados y tenants no los ven', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrar(e.pool);
  assert.deepEqual((await e.funds.cobrosDelAliado({ user: s.aliado.ctx })).cobros, []);

  const { pago: p } = await e.pagos.registrar(s.cliente.ctx, pago(s));
  const mios = (await e.funds.cobrosDelAliado({ user: s.aliado.ctx })).cobros;
  assert.deepEqual(mios.map((c) => [c.pagoId, c.estado, c.liquidacion]), [[p.id, 'RETENIDA', null]]);

  const otroAliado = await aliadoDe(e.pool, s.tenant);
  assert.deepEqual((await e.funds.cobrosDelAliado({ user: otroAliado.ctx })).cobros, []);
  const otroTenant = await sembrar(e.pool);
  assert.deepEqual((await e.funds.cobrosDelAliado({ user: otroTenant.aliado.ctx })).cobros, []);
  // El usuario del aliado A con el tenant B no tiene perfil de aliado allí.
  await assert.rejects(e.funds.cobrosDelAliado({ user: { ...s.aliado.ctx, tenantId: otroTenant.tenant } }), (err) => err.code === 'MANI-FON-403A');
  await assert.rejects(e.funds.cobrosDelAliado({ user: s.cliente.ctx }), (err) => err.statusCode === 403);
});

test('PG 891 C3: solo el cliente que pagó ve la retención; otro cliente, otro tenant o un aliado reciben 404/403', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrar(e.pool);
  const { pago: p } = await e.pagos.registrar(s.cliente.ctx, pago(s));
  const otroCliente = await clienteDe(e.pool, s.tenant);
  await assert.rejects(e.funds.retencion({ user: otroCliente.ctx, pagoId: p.id }), (err) => err.code === 'MANI-FON-404');
  const ajeno = await sembrar(e.pool);
  await assert.rejects(e.funds.retencion({ user: ajeno.cliente.ctx, pagoId: p.id }), (err) => err.code === 'MANI-FON-404');
  await assert.rejects(e.funds.retencion({ user: s.aliado.ctx, pagoId: p.id }), (err) => err.statusCode === 403);
  await assert.rejects(e.funds.retencion({ user: s.cliente.ctx, pagoId: uuid() }), (err) => err.code === 'MANI-FON-404');
});

test('PG RLS: sin contexto de tenant mani_core_svc no ve filas; la liquidación es inmutable para el servicio', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrar(e.pool);
  await e.pagos.registrar(s.cliente.ctx, pago(s));
  await iniciar(e, s);
  await finalizar(e, s);
  for (const tabla of ['retencion_fondos', 'liquidacion']) {
    assert.equal((await e.corePool.query(`SELECT count(*)::int AS n FROM ${tabla}`)).rows[0].n, 0, tabla);
  }
  await assert.rejects(e.corePool.query('UPDATE liquidacion SET comision = 0'), (err) => err.code === '42501');
  await assert.rejects(e.corePool.query('DELETE FROM retencion_fondos'), (err) => err.code === '42501');
  await assert.rejects(e.pool.query('UPDATE liquidacion SET comision = comision + 1'), (err) => err.code === '23514', 'bruto = comisión + neto');
});
