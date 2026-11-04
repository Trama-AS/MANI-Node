// SCRUM-1432 (observación de QA): el pago aprobado aparece en la bitácora de la solicitud, contra PostgreSQL real y
// conectados como `mani_core_svc` (sin BYPASSRLS). Se omite sin TEST_DATABASE_URL; en CI corre siempre.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgPaymentRepository = require('../../../src/infrastructure/repositories/PgPaymentRepository');
const PgServiceEventRepository = require('../../../src/infrastructure/repositories/PgServiceEventRepository');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };
const uuid = () => crypto.randomUUID();
const comoCore = (u) => `${u}${u.includes('?') ? '&' : '?'}options=-c%20role%3Dmani_core_svc`;

async function entorno(t) {
  const admin = new PgPoolFactory({ databaseUrl: url });
  const core = new PgPoolFactory({ databaseUrl: comoCore(url) });
  t.after(() => Promise.all([admin.close(), core.close()]));
  return {
    pool: admin.getPool(),
    pagos: new PgPaymentRepository({ pgPoolFactory: core }),
    eventos: new PgServiceEventRepository({ pgPoolFactory: core }),
  };
}

async function usuario(pool, tenant, rol) {
  const id = uuid();
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, $4, 'ACTIVO')", [id, tenant, `${id}@t.test`, rol]);
  return id;
}

async function sembrar(pool) {
  const tenant = uuid();
  const [zona, categoria, sitio, solicitud, cotizacion, cliente, aliado] = Array.from({ length: 7 }, uuid);
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [tenant, `t-${tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, estado) VALUES ($1, 'CIUDAD', 'Z', 'ACTIVO')", [zona]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Plomeria', 'ACTIVO')", [categoria, tenant]);
  const usuarioCliente = await usuario(pool, tenant, 'CLIENTE');
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [cliente, tenant, usuarioCliente]);
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1')", [sitio, tenant, cliente, zona]);
  const usuarioAliado = await usuario(pool, tenant, 'ALIADO');
  await pool.query("INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'Ana', 'VERIFICADO')", [aliado, tenant, usuarioAliado]);
  await pool.query("INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, aliado_id, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACEPTADA')", [solicitud, tenant, cliente, sitio, categoria, zona, aliado]);
  await pool.query("INSERT INTO cotizacion (id, tenant_id, solicitud_id, aliado_id, valor_mano_obra, valor_materiales, estado) VALUES ($1, $2, $3, $4, 100000.50, 50000, 'ACEPTADA')", [cotizacion, tenant, solicitud, aliado]);
  return {
    tenant, solicitud, cotizacion, cliente,
    ctxCliente: { tenantId: tenant, userId: usuarioCliente, role: 'CLIENT' },
    ctxAliado: { tenantId: tenant, userId: usuarioAliado, role: 'ALLY' },
  };
}

const pago = (s, extra = {}) => ({
  cotizacionId: s.cotizacion, clienteId: s.cliente, monto: 150000.5, moneda: 'COP', estado: 'APROBADO', proveedor: 'mock',
  simulado: true, referenciaProveedor: `mock-${uuid()}`, correlationId: uuid(), claveIdempotencia: null, ...extra,
});
const delPago = (eventos) => eventos.filter((e) => e.tipo === 'PAGO_REGISTRADO');

test('PG bitácora: el pago aprobado aparece en la bitácora para el cliente dueño y para el aliado asignado', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrar(e.pool);
  await e.pagos.registrar(s.ctxCliente, pago(s));

  for (const ctx of [s.ctxCliente, s.ctxAliado]) {
    const [ev, ...resto] = delPago(await e.eventos.listar(ctx, s.solicitud));
    assert.equal(resto.length, 0, ctx.role);
    assert.equal(ev.descripcion, 'Pago aprobado (simulado)');
    assert.equal(ev.autor.rol, 'CLIENTE', 'lo registra el cliente que pagó');
  }
});

test('PG bitácora: la descripción no revela el monto ni la referencia del proveedor', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrar(e.pool);
  await e.pagos.registrar(s.ctxCliente, pago(s, { referenciaProveedor: 'mock-secreta-123' }));
  const [ev] = delPago(await e.eventos.listar(s.ctxAliado, s.solicitud));
  assert.ok(!/150000|mock-secreta|COP/.test(ev.descripcion));
});

test('PG bitácora: un pago rechazado o pendiente no deja evento', opts, async (t) => {
  const e = await entorno(t);
  for (const estado of ['RECHAZADO', 'PENDIENTE']) {
    const s = await sembrar(e.pool);
    await e.pagos.registrar(s.ctxCliente, pago(s, { estado, motivo: 'sin fondos' }));
    assert.equal(delPago(await e.eventos.listar(s.ctxCliente, s.solicitud)).length, 0, estado);
  }
});

test('PG bitácora: reintentar con la misma clave o un segundo cobro aprobado no duplican el evento', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrar(e.pool);
  const clave = uuid();
  await e.pagos.registrar(s.ctxCliente, pago(s, { claveIdempotencia: clave }));
  await e.pagos.registrar(s.ctxCliente, pago(s, { claveIdempotencia: clave })).catch(() => {});
  await assert.rejects(e.pagos.registrar(s.ctxCliente, pago(s, { claveIdempotencia: uuid() })), (err) => err.code === 'MANI-PAG-409A');
  assert.equal(delPago(await e.eventos.listar(s.ctxCliente, s.solicitud)).length, 1);
});

test('PG bitácora: otro cliente, otro tenant y el aliado de otra solicitud no ven el evento', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrar(e.pool);
  const otro = await sembrar(e.pool);
  await e.pagos.registrar(s.ctxCliente, pago(s));

  for (const ctx of [otro.ctxCliente, otro.ctxAliado]) {
    await assert.rejects(e.eventos.listar(ctx, s.solicitud), (err) => err.code === 'MANI-EVT-404', ctx.role);
  }
  const otroDelTenant = await usuario(e.pool, s.tenant, 'CLIENTE');
  await e.pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [uuid(), s.tenant, otroDelTenant]);
  await assert.rejects(
    e.eventos.listar({ tenantId: s.tenant, userId: otroDelTenant, role: 'CLIENT' }, s.solicitud),
    (err) => err.code === 'MANI-EVT-404'
  );
});

test('PG bitácora: si el pago no se guarda (segundo cobro aprobado) tampoco queda el evento; el pago y su evento nacen juntos', opts, async (t) => {
  const e = await entorno(t);
  const s = await sembrar(e.pool);
  const { pago: p } = await e.pagos.registrar(s.ctxCliente, pago(s));
  const n = async () => Number((await e.pool.query("SELECT count(*) AS n FROM evento_servicio WHERE solicitud_id = $1 AND tipo_evento = 'PAGO_REGISTRADO'", [s.solicitud])).rows[0].n);
  assert.equal(await n(), 1);
  assert.equal(Number((await e.pool.query('SELECT count(*) AS n FROM pago WHERE id = $1', [p.id])).rows[0].n), 1);
});
