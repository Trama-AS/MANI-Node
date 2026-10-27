// SCRUM-1450 (TEC-03, D-3, P-6): el rechazo de una oferta, escrito por Dispatch con su rol de servicio
// `mani_dispatch_svc`, contra PostgreSQL real. Se omite sin TEST_DATABASE_URL.
// La sesión asume el rol de Dispatch (sin BYPASSRLS y sin permiso sobre `aliado`), así que la política RLS sí se evalúa.
// Preparación local: scripts/preparar-base-pruebas.sh (esquema base 001-008 + db/migrations 0001-0016).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const { runInTenantContext } = require('../../../src/infrastructure/db/runInTenantContext');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };
const uuid = () => crypto.randomUUID();

/** Misma base, pero la sesión asume el rol de servicio de Dispatch. */
const comoDispatch = (u) => `${u}${u.includes('?') ? '&' : '?'}options=-c%20role%3Dmani_dispatch_svc`;

async function sembrarAliado(pool, tenant, nombre) {
  const usuario = uuid();
  const aliado = uuid();
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'ALIADO', 'ACTIVO')", [usuario, tenant, `${usuario}@t.test`]);
  await pool.query(
    "INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', $4, 'VERIFICADO')",
    [aliado, tenant, usuario, nombre]
  );
  return { usuario, aliado, ctx: { tenantId: tenant, userId: usuario, role: 'ALLY' } };
}

async function sembrar(pool) {
  const tenant = uuid();
  const zona = uuid();
  const categoria = uuid();
  const clienteUsuario = uuid();
  const cliente = uuid();
  const sitio = uuid();
  const solicitud = uuid();
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [tenant, `t-${tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, estado) VALUES ($1, 'CIUDAD', 'Z', 'ACTIVO')", [zona]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Plomeria', 'ACTIVO')", [categoria, tenant]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVO')", [clienteUsuario, tenant, `${clienteUsuario}@t.test`]);
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [cliente, tenant, clienteUsuario]);
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1')", [sitio, tenant, cliente, zona]);
  await pool.query(
    "INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, estado) VALUES ($1, $2, $3, $4, $5, $6, 'PENDIENTE')",
    [solicitud, tenant, cliente, sitio, categoria, zona]
  );
  const ana = await sembrarAliado(pool, tenant, 'Ana');
  const beto = await sembrarAliado(pool, tenant, 'Beto');
  return { tenant, solicitud, ana, beto };
}

async function entorno(t) {
  const admin = new PgPoolFactory({ databaseUrl: url });
  const dispatch = new PgPoolFactory({ databaseUrl: comoDispatch(url) });
  t.after(() => Promise.all([admin.close(), dispatch.close()]));
  return { pool: admin.getPool(), dispatch };
}

// El mismo SQL que ejecuta Dispatch (PostgresSolicitudAssignmentRepository.RejectRequestAsync).
const RECHAZAR = `INSERT INTO solicitud_rechazo (tenant_id, solicitud_id, aliado_id, motivo)
                  VALUES ($1, $2, $3, $4)
                  ON CONFLICT (solicitud_id, aliado_id) DO NOTHING`;

const rechazar = (dispatch, ctx, { tenant, solicitud, aliado, motivo = 'OTRO' }) =>
  runInTenantContext(dispatch, ctx, (client) => client.query(RECHAZAR, [tenant, solicitud, aliado, motivo]));

const contar = async (pool, solicitud) =>
  (await pool.query('SELECT count(*)::int AS n FROM solicitud_rechazo WHERE solicitud_id = $1', [solicitud])).rows[0].n;

test('PG D-3: Dispatch registra el rechazo del aliado de la sesión con su rol de servicio', opts, async (t) => {
  const { pool, dispatch } = await entorno(t);
  const s = await sembrar(pool);

  await rechazar(dispatch, s.ana.ctx, { tenant: s.tenant, solicitud: s.solicitud, aliado: s.ana.aliado, motivo: 'FUERA_DE_ZONA' });

  const fila = (await pool.query('SELECT * FROM solicitud_rechazo WHERE solicitud_id = $1', [s.solicitud])).rows[0];
  assert.equal(fila.aliado_id, s.ana.aliado);
  assert.equal(fila.tenant_id, s.tenant);
  assert.equal(fila.motivo, 'FUERA_DE_ZONA');
});

test('PG D-3: repetir el rechazo no duplica ni falla (ON CONFLICT DO NOTHING)', opts, async (t) => {
  const { pool, dispatch } = await entorno(t);
  const s = await sembrar(pool);
  const datos = { tenant: s.tenant, solicitud: s.solicitud, aliado: s.ana.aliado };

  await rechazar(dispatch, s.ana.ctx, datos);
  await rechazar(dispatch, s.ana.ctx, datos);

  assert.equal(await contar(pool, s.solicitud), 1);
});

test('PG D-3: la política sigue exigiendo aliado propio — nadie rechaza en nombre de otro aliado', opts, async (t) => {
  const { pool, dispatch } = await entorno(t);
  const s = await sembrar(pool);

  await assert.rejects(
    () => rechazar(dispatch, s.ana.ctx, { tenant: s.tenant, solicitud: s.solicitud, aliado: s.beto.aliado }),
    /row-level security/
  );
  assert.equal(await contar(pool, s.solicitud), 0);
});

test('PG D-3: la política sigue exigiendo el mismo tenant — un aliado de otro tenant no escribe en este', opts, async (t) => {
  const { pool, dispatch } = await entorno(t);
  const a = await sembrar(pool);
  const b = await sembrar(pool);

  // El contexto es del tenant B, pero la fila apunta al tenant A y a su aliado.
  await assert.rejects(
    () => rechazar(dispatch, b.ana.ctx, { tenant: a.tenant, solicitud: a.solicitud, aliado: a.ana.aliado }),
    /row-level security/
  );
  // Con el contexto de B y un aliado de A bajo el tenant de B tampoco.
  await assert.rejects(
    () => rechazar(dispatch, b.ana.ctx, { tenant: b.tenant, solicitud: b.solicitud, aliado: a.ana.aliado }),
    /row-level security|foreign key/
  );
  assert.equal(await contar(pool, a.solicitud), 0);
});

test('PG D-3: Dispatch lee solo sus propios rechazos, no los de otro aliado ni los de otro tenant', opts, async (t) => {
  const { pool, dispatch } = await entorno(t);
  const a = await sembrar(pool);
  const b = await sembrar(pool);
  await pool.query('INSERT INTO solicitud_rechazo (tenant_id, solicitud_id, aliado_id) VALUES ($1, $2, $3)', [a.tenant, a.solicitud, a.ana.aliado]);
  await pool.query('INSERT INTO solicitud_rechazo (tenant_id, solicitud_id, aliado_id) VALUES ($1, $2, $3)', [a.tenant, a.solicitud, a.beto.aliado]);
  await pool.query('INSERT INTO solicitud_rechazo (tenant_id, solicitud_id, aliado_id) VALUES ($1, $2, $3)', [b.tenant, b.solicitud, b.ana.aliado]);

  const veAna = await runInTenantContext(dispatch, a.ana.ctx, (c) => c.query('SELECT aliado_id FROM solicitud_rechazo'));
  assert.deepEqual(veAna.rows.map((r) => r.aliado_id), [a.ana.aliado]);
  const veBeto = await runInTenantContext(dispatch, a.beto.ctx, (c) => c.query('SELECT aliado_id FROM solicitud_rechazo'));
  assert.deepEqual(veBeto.rows.map((r) => r.aliado_id), [a.beto.aliado]);
});

test('PG D-3 / ADR-0030: la corrección no le da a Dispatch lectura sobre `aliado`', opts, async (t) => {
  const { pool, dispatch } = await entorno(t);
  const s = await sembrar(pool);

  await assert.rejects(
    () => runInTenantContext(dispatch, s.ana.ctx, (client) => client.query('SELECT id FROM aliado')),
    /permission denied for table aliado/
  );
  const tiene = (await pool.query("SELECT has_table_privilege('mani_dispatch_svc', 'public.aliado', 'SELECT') AS lee")).rows[0].lee;
  assert.equal(tiene, false);
});

test('PG D-3: la función de la política solo contesta por el aliado de la sesión y no está abierta al público', opts, async (t) => {
  const { pool, dispatch } = await entorno(t);
  const s = await sembrar(pool);

  const consulta = (ctx, aliado) =>
    runInTenantContext(dispatch, ctx, async (client) => (await client.query('SELECT app.es_aliado_del_usuario($1) AS si', [aliado])).rows[0].si);
  assert.equal(await consulta(s.ana.ctx, s.ana.aliado), true);
  assert.equal(await consulta(s.ana.ctx, s.beto.aliado), false, 'no sirve para sondear a otro aliado del tenant');
  assert.equal(await consulta(s.ana.ctx, uuid()), false);

  const privilegios = (
    await pool.query(
      `SELECT r AS rol, has_function_privilege(r, 'app.es_aliado_del_usuario(uuid)', 'EXECUTE') AS ejecuta
       FROM unnest(ARRAY['anon', 'mani_dispatch_svc', 'mani_core_svc']) AS r`
    )
  ).rows;
  const ejecuta = Object.fromEntries(privilegios.map((p) => [p.rol, p.ejecuta]));
  assert.deepEqual(ejecuta, { anon: false, mani_dispatch_svc: true, mani_core_svc: false });
});

test('PG D-3: sin DATABASE_URL el rechazo falla cerrado con 503', async () => {
  const dispatch = new PgPoolFactory({ databaseUrl: undefined });
  await assert.rejects(() => rechazar(dispatch, { tenantId: uuid(), userId: uuid(), role: 'ALLY' }, { tenant: uuid(), solicitud: uuid(), aliado: uuid() }), (err) => err.statusCode === 503);
});
