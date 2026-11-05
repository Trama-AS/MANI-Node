// HU-M11-01 (SCRUM-1432): los pagos del sandbox contra PostgreSQL real, conectados como `mani_core_svc` (sin BYPASSRLS)
// para que las políticas RLS sí se evalúen. Se omite sin TEST_DATABASE_URL.
// Preparación local: PostgreSQL 15 con las migraciones 001-008 de MANI-.NET (tests/.../Database/migrations), los roles
// `anon`, `authenticated` y `service_role`, un esquema `auth` cuya `auth.jwt()` lea `request.jwt.claims` (como la de Supabase), y db/migrations/0001-0015.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgPaymentRepository = require('../../../src/infrastructure/repositories/PgPaymentRepository');
const { runInTenantContext } = require('../../../src/infrastructure/db/runInTenantContext');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };
const uuid = () => crypto.randomUUID();

/** Misma base, pero la sesión asume el rol de servicio de Core: las políticas RLS se aplican. */
const comoCore = (u) => `${u}${u.includes('?') ? '&' : '?'}options=-c%20role%3Dmani_core_svc`;

async function sembrarTenant(pool, { estadoCotizacion = 'ACEPTADA' } = {}) {
  const s = { tenant: uuid(), usuario: uuid(), cliente: uuid(), solicitud: uuid(), cotizacion: uuid() };
  const zona = uuid();
  const categoria = uuid();
  const sitio = uuid();
  const usuarioAliado = uuid();
  const aliado = uuid();
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [s.tenant, `t-${s.tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, estado) VALUES ($1, 'CIUDAD', 'Z', 'ACTIVO')", [zona]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Plomeria', 'ACTIVO')", [categoria, s.tenant]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVO')", [s.usuario, s.tenant, `${s.usuario}@t.test`]);
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [s.cliente, s.tenant, s.usuario]);
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1')", [sitio, s.tenant, s.cliente, zona]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'ALIADO', 'ACTIVO')", [usuarioAliado, s.tenant, `${usuarioAliado}@t.test`]);
  await pool.query("INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'Ana', 'VERIFICADO')", [aliado, s.tenant, usuarioAliado]);
  await pool.query(
    "INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, aliado_id, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACEPTADA')",
    [s.solicitud, s.tenant, s.cliente, sitio, categoria, zona, aliado]
  );
  await pool.query(
    'INSERT INTO cotizacion (id, tenant_id, solicitud_id, aliado_id, valor_mano_obra, valor_materiales, estado) VALUES ($1, $2, $3, $4, 100000.50, 50000, $5)',
    [s.cotizacion, s.tenant, s.solicitud, aliado, estadoCotizacion]
  );
  return { ...s, ctx: { tenantId: s.tenant, userId: s.usuario, role: 'CLIENT' } };
}

async function entorno(t) {
  const admin = new PgPoolFactory({ databaseUrl: url });
  const core = new PgPoolFactory({ databaseUrl: comoCore(url) });
  t.after(() => Promise.all([admin.close(), core.close()]));
  return { pool: admin.getPool(), repo: new PgPaymentRepository({ pgPoolFactory: core }), core };
}

const aprobado = (s, extra = {}) => ({
  cotizacionId: s.cotizacion, clienteId: s.cliente, monto: 150000.5, moneda: 'COP', estado: 'APROBADO', proveedor: 'mock',
  simulado: true, referenciaProveedor: `mock-pay-${uuid()}`, correlationId: 'corr-pg', claveIdempotencia: null, ...extra,
});

test('PG: prepara el cobro con el monto de la cotización y registra el pago como simulado', opts, async (t) => {
  const { pool, repo } = await entorno(t);
  const s = await sembrarTenant(pool);

  const { cobro } = await repo.prepararCobro(s.ctx, { cotizacionId: s.cotizacion, claveIdempotencia: null });
  assert.equal(cobro.monto, 150000.5, 'mano de obra + materiales, calculado por la base');
  assert.equal(cobro.clienteId, s.cliente);

  const { pago, creado } = await repo.registrar(s.ctx, aprobado(s));
  assert.equal(creado, true);
  assert.equal(pago.estado, 'APROBADO');
  assert.equal(pago.simulado, true);

  const fila = (await pool.query('SELECT * FROM pago WHERE id = $1', [pago.id])).rows[0];
  assert.equal(fila.tenant_id, s.tenant);
  assert.equal(fila.cliente_id, s.cliente);
  assert.equal(fila.correlation_id, 'corr-pg');
  assert.equal(Number(fila.monto), 150000.5);
});

test('PG: un reintento con la misma clave devuelve el pago ya registrado y no cobra dos veces', opts, async (t) => {
  const { pool, repo } = await entorno(t);
  const s = await sembrarTenant(pool);
  const clave = uuid();

  const primero = await repo.registrar(s.ctx, aprobado(s, { claveIdempotencia: clave }));
  const reintento = await repo.registrar(s.ctx, aprobado(s, { claveIdempotencia: clave, referenciaProveedor: 'otra' }));

  assert.equal(primero.creado, true);
  assert.equal(reintento.creado, false);
  assert.equal(reintento.pago.id, primero.pago.id);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM pago WHERE cotizacion_id = $1', [s.cotizacion])).rows[0].n, 1);
  assert.equal((await repo.prepararCobro(s.ctx, { cotizacionId: s.cotizacion, claveIdempotencia: clave })).existente.id, primero.pago.id);
});

test('PG: una cotización no se cobra dos veces aunque cambie la clave; un rechazo previo no lo impide', opts, async (t) => {
  const { pool, repo } = await entorno(t);
  const s = await sembrarTenant(pool);

  await repo.registrar(s.ctx, aprobado(s, { estado: 'RECHAZADO', motivo: 'simulado' }));
  await repo.registrar(s.ctx, aprobado(s, { estado: 'PENDIENTE' }));
  await repo.registrar(s.ctx, aprobado(s, { claveIdempotencia: uuid() }));

  await assert.rejects(
    () => repo.registrar(s.ctx, aprobado(s, { claveIdempotencia: uuid() })),
    (err) => err.statusCode === 409 && err.code === 'MANI-PAG-409A'
  );
  await assert.rejects(
    () => repo.prepararCobro(s.ctx, { cotizacionId: s.cotizacion, claveIdempotencia: null }),
    (err) => err.code === 'MANI-PAG-409A'
  );
  assert.equal((await pool.query("SELECT count(*)::int AS n FROM pago WHERE estado = 'APROBADO' AND cotizacion_id = $1", [s.cotizacion])).rows[0].n, 1);
});

test('PG: solo una cotización aceptada admite pago', opts, async (t) => {
  const { pool, repo } = await entorno(t);
  const s = await sembrarTenant(pool, { estadoCotizacion: 'PENDIENTE' });

  await assert.rejects(
    () => repo.prepararCobro(s.ctx, { cotizacionId: s.cotizacion, claveIdempotencia: null }),
    (err) => err.statusCode === 409 && err.code === 'MANI-PAG-409E'
  );
});

test('PG C3: otro cliente o tenant no paga, consulta ni ve la cotización ni el pago de este cliente (404)', opts, async (t) => {
  const { pool, repo } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  const { pago } = await repo.registrar(a.ctx, aprobado(a));

  const noEncontrado = (err) => err.statusCode === 404 && err.code === 'MANI-PAG-404';
  await assert.rejects(() => repo.prepararCobro(b.ctx, { cotizacionId: a.cotizacion, claveIdempotencia: null }), noEncontrado);
  await assert.rejects(() => repo.obtener(b.ctx, pago.id), noEncontrado);

  // Otro cliente del MISMO tenant tampoco.
  const otroUsuario = uuid();
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVO')", [otroUsuario, a.tenant, `${otroUsuario}@t.test`]);
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [uuid(), a.tenant, otroUsuario]);
  const vecino = { tenantId: a.tenant, userId: otroUsuario, role: 'CLIENT' };
  await assert.rejects(() => repo.prepararCobro(vecino, { cotizacionId: a.cotizacion, claveIdempotencia: null }), noEncontrado);
  await assert.rejects(() => repo.obtener(vecino, pago.id), noEncontrado);

  assert.equal((await repo.obtener(a.ctx, pago.id)).id, pago.id, 'el dueño sí lo ve');
});

test('PG RLS: con el rol de servicio la base misma aísla los pagos por tenant y no permite modificarlos', opts, async (t) => {
  const { pool, repo, core } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  await repo.registrar(a.ctx, aprobado(a));

  // Sin filtro de aplicación a propósito: la política sola debe bloquear el acceso cruzado.
  const vistosPorB = await runInTenantContext(core, b.ctx, (client) => client.query('SELECT count(*)::int AS n FROM pago'));
  assert.equal(vistosPorB.rows[0].n, 0);
  const vistosPorA = await runInTenantContext(core, a.ctx, (client) => client.query('SELECT count(*)::int AS n FROM pago'));
  assert.equal(vistosPorA.rows[0].n, 1);

  // No se puede escribir un pago de otro tenant (WITH CHECK)...
  await assert.rejects(
    () => runInTenantContext(core, b.ctx, (client) =>
      client.query(
        "INSERT INTO pago (tenant_id, cotizacion_id, cliente_id, monto, estado, proveedor, referencia_proveedor) VALUES ($1, $2, $3, 1, 'APROBADO', 'mock', 'x')",
        [a.tenant, a.cotizacion, a.cliente]
      )),
    /row-level security/
  );
  // ...ni modificar ni borrar uno propio: el servicio solo tiene SELECT e INSERT.
  for (const sql of ['UPDATE pago SET estado = $1', 'DELETE FROM pago WHERE $1::text IS NOT NULL']) {
    await assert.rejects(() => runInTenantContext(core, a.ctx, (client) => client.query(sql, ['RECHAZADO'])), /permission denied/);
  }
});

test('PG: sin DATABASE_URL los pagos fallan cerrado con 503', async () => {
  const repo = new PgPaymentRepository({ pgPoolFactory: new PgPoolFactory({ databaseUrl: undefined }) });
  const ctx = { tenantId: uuid(), userId: uuid(), role: 'CLIENT' };
  await assert.rejects(() => repo.prepararCobro(ctx, { cotizacionId: uuid(), claveIdempotencia: null }), (err) => err.statusCode === 503);
});
