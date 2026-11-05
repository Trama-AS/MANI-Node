// SCRUM-1468 (TEC-21): criterio de aceptación. Core y Dispatch se conectan con un rol propio sin BYPASSRLS, ninguna
// política de datos de tenant queda TO public (R-06) y, con el filtro de aplicación desactivado a propósito (consultas
// SIN `WHERE tenant_id`), la política sigue bloqueando el acceso cruzado. Así RNF-01 no descansa solo en el código.
//
// Se omite sin TEST_DATABASE_URL; en CI corre siempre (scripts/preparar-base-pruebas.sh aplica todas las migraciones).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { fabricasPg, comoRol } = require('../../helpers/pgPruebas');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const { withTenantContext } = require('../../../src/infrastructure/db/withTenantContext');
const { inspeccionarRol } = require('../../../src/infrastructure/db/verificarRolServicio');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };
const uuid = () => crypto.randomUUID();
const MIGRACION_0037 = path.join(__dirname, '../../../db/migrations/0037_retirar_politicas_to_public.sql');
const MIGRACION_0038 = path.join(__dirname, '../../../db/migrations/0038_retirar_politica_documento_legal_heredada.sql');

/** Dos tenants con un usuario aliado, su aliado, un cliente con sede y una solicitud cada uno. */
async function sembrarDosTenants(pool) {
  const zona = uuid();
  const categoria = { a: uuid(), b: uuid() };
  await pool.query("INSERT INTO zona (id, nivel, nombre, estado) VALUES ($1, 'CIUDAD', 'Z-1468', 'ACTIVO')", [zona]);
  const sembrar = async (clave) => {
    const t = { tenant: uuid(), usuarioAliado: uuid(), aliado: uuid(), usuarioCliente: uuid(), cliente: uuid(), sitio: uuid(), solicitud: uuid() };
    await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, $2, $3, 'ACTIVO')", [t.tenant, `T-${clave}`, `t-${t.tenant}`]);
    await pool.query(
      "INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'ALIADO', 'ACTIVO'), ($4, $2, $5, 'CLIENTE', 'ACTIVO')",
      [t.usuarioAliado, t.tenant, `${t.usuarioAliado}@t.test`, t.usuarioCliente, `${t.usuarioCliente}@t.test`]
    );
    await pool.query(
      "INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', $4, 'PENDIENTE')",
      [t.aliado, t.tenant, t.usuarioAliado, `Aliado ${clave}`]
    );
    await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [
      t.cliente,
      t.tenant,
      t.usuarioCliente,
    ]);
    await pool.query('INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, $5)', [
      t.sitio,
      t.tenant,
      t.cliente,
      zona,
      `Calle ${clave}`,
    ]);
    await pool.query(
      "INSERT INTO categoria_servicio (id, tenant_id, nombre, estado, flujo_operativo) VALUES ($1, $2, $3, 'ACTIVO', 'COTIZACION_PREVIA')",
      [categoria[clave], t.tenant, `Plomería ${t.tenant}`]
    );
    await pool.query(
      `INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, estado)
       VALUES ($1, $2, $3, $4, $5, $6, 'PENDIENTE')`,
      [t.solicitud, t.tenant, t.cliente, t.sitio, categoria[clave], zona]
    );
    await pool.query(
      "INSERT INTO documento_kyc (tenant_id, aliado_id, tipo_documento, ruta_storage, estado) VALUES ($1, $2, 'CEDULA', $3, 'PENDIENTE')",
      [t.tenant, t.aliado, `${t.tenant}/${t.usuarioAliado}/cedula.pdf`]
    );
    return t;
  };
  return { a: await sembrar('a'), b: await sembrar('b') };
}

/** Ejecuta `sql` como el rol de `fabrica` dentro del contexto de `ctx` y devuelve las filas. */
async function enContexto(fabrica, ctx, sql, params = []) {
  return withTenantContext(fabrica.getPool(), ctx, async (client) => (await client.query(sql, params)).rows);
}

test('TEC-21: los roles de servicio no tienen SUPERUSER ni BYPASSRLS y la conexión de prueba los usa', opts, async (t) => {
  const { admin, core } = fabricasPg(t, url);
  const dispatch = new PgPoolFactory({ databaseUrl: comoRol(url, 'mani_dispatch_svc') });
  t.after(() => dispatch.close());

  const { rows } = await admin.getPool().query(
    "SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('mani_core_svc', 'mani_dispatch_svc') ORDER BY rolname"
  );
  assert.deepEqual(rows, [
    { rolname: 'mani_core_svc', rolsuper: false, rolbypassrls: false },
    { rolname: 'mani_dispatch_svc', rolsuper: false, rolbypassrls: false },
  ]);

  // La verificación de arranque de Core ve lo mismo desde cada conexión.
  assert.deepEqual(await inspeccionarRol(core.getPool()), { rol: 'mani_core_svc', saltaRls: false });
  assert.deepEqual(await inspeccionarRol(dispatch.getPool()), { rol: 'mani_dispatch_svc', saltaRls: false });
  assert.equal((await inspeccionarRol(admin.getPool())).saltaRls, true, 'postgres sí salta RLS: Core no debe usarlo');
});

test('TEC-21: con el filtro de aplicación desactivado, mani_core_svc solo ve y toca su tenant', opts, async (t) => {
  const { pool, core } = fabricasPg(t, url);
  const { a, b } = await sembrarDosTenants(pool);
  const ctxA = { tenantId: a.tenant, userId: a.usuarioAliado, role: 'aliado' };

  // Lecturas SIN `WHERE tenant_id`: lo que devuelve lo decide solo la política.
  for (const tabla of ['usuario', 'aliado', 'cliente', 'sitio', 'categoria_servicio', 'solicitud']) {
    const filas = await enContexto(core, ctxA, `SELECT tenant_id FROM ${tabla}`);
    assert.ok(filas.length > 0, `${tabla}: el tenant A ve sus filas`);
    assert.ok(
      filas.every((f) => f.tenant_id === a.tenant),
      `${tabla}: ninguna fila de otro tenant, aunque la consulta no filtra`
    );
  }

  // Buscar por id una fila del tenant B, sin filtro de tenant, no la encuentra.
  assert.deepEqual(await enContexto(core, ctxA, 'SELECT id FROM aliado WHERE id = $1', [b.aliado]), []);
  assert.deepEqual(await enContexto(core, ctxA, 'SELECT id FROM usuario WHERE id = $1', [b.usuarioCliente]), []);

  // Modificar o borrar la fila del tenant B afecta 0 filas.
  const cambio = await withTenantContext(core.getPool(), ctxA, (c) =>
    c.query("UPDATE aliado SET nombre_razon_social = 'secuestrado' WHERE id = $1", [b.aliado])
  );
  assert.equal(cambio.rowCount, 0);
  const borrado = await withTenantContext(core.getPool(), ctxA, (c) => c.query('DELETE FROM sitio WHERE id = $1', [b.sitio]));
  assert.equal(borrado.rowCount, 0);
  const intacta = await pool.query('SELECT nombre_razon_social FROM aliado WHERE id = $1', [b.aliado]);
  assert.equal(intacta.rows[0].nombre_razon_social, 'Aliado b');

  // Escribir una fila a nombre del tenant B la rechaza WITH CHECK (42501).
  await assert.rejects(
    withTenantContext(core.getPool(), ctxA, (c) =>
      c.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, 'x@t.test', 'CLIENTE', 'ACTIVO')", [
        uuid(),
        b.tenant,
      ])
    ),
    (err) => err.code === '42501'
  );
});

test('TEC-21: sin app.set_context mani_core_svc no ve datos de ningún tenant (falla cerrada)', opts, async (t) => {
  const { pool, core } = fabricasPg(t, url);
  await sembrarDosTenants(pool);
  for (const tabla of ['usuario', 'aliado', 'cliente', 'sitio', 'solicitud', 'documento_kyc']) {
    const { rows } = await core.getPool().query(`SELECT 1 FROM ${tabla} LIMIT 1`);
    assert.equal(rows.length, 0, `${tabla}: sin contexto no hay filas visibles`);
  }
});

test('TEC-21: documento_kyc exige además el propio aliado o el admin del tenant', opts, async (t) => {
  const { pool, core } = fabricasPg(t, url);
  const { a } = await sembrarDosTenants(pool);
  const admin = uuid();
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'ADMIN_TENANT', 'ACTIVO')", [
    admin,
    a.tenant,
    `${admin}@t.test`,
  ]);

  const leer = (ctx) => enContexto(core, ctx, 'SELECT aliado_id FROM documento_kyc');
  assert.equal((await leer({ tenantId: a.tenant, userId: a.usuarioAliado, role: 'aliado' })).length, 1, 'el aliado ve los suyos');
  assert.equal((await leer({ tenantId: a.tenant, userId: admin, role: 'admin_tenant' })).length, 1, 'el admin del tenant los ve');
  assert.equal((await leer({ tenantId: a.tenant, userId: a.usuarioCliente, role: 'cliente' })).length, 0, 'un cliente del mismo tenant no');
  assert.equal((await leer({ tenantId: a.tenant, userId: null, role: null })).length, 0, 'sin usuario, ninguno');
});

test('TEC-21: con el filtro desactivado, mani_dispatch_svc solo ve las solicitudes de su tenant', opts, async (t) => {
  const { pool } = fabricasPg(t, url);
  const dispatch = new PgPoolFactory({ databaseUrl: comoRol(url, 'mani_dispatch_svc') });
  t.after(() => dispatch.close());
  const { a, b } = await sembrarDosTenants(pool);

  const filas = await enContexto(dispatch, { tenantId: a.tenant, userId: a.usuarioAliado, role: 'aliado' }, 'SELECT id, tenant_id FROM solicitud');
  assert.ok(filas.some((f) => f.id === a.solicitud));
  assert.ok(filas.every((f) => f.tenant_id === a.tenant));
  assert.ok(!filas.some((f) => f.id === b.solicitud));

  // Dispatch no tiene GRANT sobre las tablas de Core (ADR-0030): ni con contexto puede leer aliados.
  await assert.rejects(
    enContexto(dispatch, { tenantId: a.tenant, userId: a.usuarioAliado, role: 'aliado' }, 'SELECT 1 FROM aliado'),
    (err) => err.code === '42501'
  );
});

test('TEC-21: el contexto funciona aunque el rol de servicio no tenga USAGE sobre el esquema auth, como en Supabase', opts, async (t) => {
  const { pool } = fabricasPg(t, url);
  const { a, b } = await sembrarDosTenants(pool);
  const cliente = await pool.connect();

  try {
    await cliente.query('BEGIN');
    // En CI el esquema auth es de postgres y el GRANT de la 0006 sí aplica; en Supabase no. ROLLBACK lo devuelve al final.
    await cliente.query('REVOKE USAGE ON SCHEMA auth FROM mani_core_svc, PUBLIC');
    const permiso = await cliente.query("SELECT has_schema_privilege('mani_core_svc', 'auth', 'USAGE') AS usa_auth");
    assert.equal(permiso.rows[0].usa_auth, false);

    await cliente.query('SET LOCAL ROLE mani_core_svc');
    await cliente.query('SELECT app.set_context($1, $2, $3)', [a.tenant, a.usuarioAliado, 'ALIADO']);
    const contexto = await cliente.query('SELECT app.tenant_id() AS tenant, app.user_id() AS usuario, app.user_role() AS rol');
    assert.deepEqual(contexto.rows[0], { tenant: a.tenant, usuario: a.usuarioAliado, rol: 'aliado' });

    const usuarios = await cliente.query('SELECT tenant_id FROM usuario WHERE tenant_id IN ($1, $2)', [a.tenant, b.tenant]);
    assert.ok(usuarios.rows.length > 0);
    assert.ok(usuarios.rows.every((f) => f.tenant_id === a.tenant));
  } finally {
    await cliente.query('ROLLBACK');
    cliente.release();
  }
});

test('TEC-21: los lectores del contexto fallan cerrado sin contexto o con un claim malformado', opts, async (t) => {
  const { core } = fabricasPg(t, url);
  const leer = 'SELECT app.tenant_id() AS tenant, app.user_id() AS usuario, app.user_role() AS rol';
  const nulos = { tenant: null, usuario: null, rol: null };

  const sinContexto = await core.getPool().query(leer);
  assert.deepEqual(sinContexto.rows[0], nulos);

  const cliente = await core.getPool().connect();
  try {
    await cliente.query('BEGIN');
    for (const claims of ['no es json', '{"sub":"no-es-uuid","app_metadata":{"tenant_id":"no-es-uuid"}}']) {
      await cliente.query("SELECT set_config('request.jwt.claims', $1, true)", [claims]);
      const { rows } = await cliente.query(leer);
      assert.equal(rows[0].tenant, null, claims);
      assert.equal(rows[0].usuario, null, claims);
    }
  } finally {
    await cliente.query('ROLLBACK');
    cliente.release();
  }
});

test('R-06: ninguna política de una tabla con tenant_id queda TO public', opts, async (t) => {
  const { pool } = fabricasPg(t, url);
  const { rows } = await pool.query(
    `SELECT p.tablename, p.policyname
       FROM pg_policies p
       JOIN information_schema.columns c
         ON c.table_schema = p.schemaname AND c.table_name = p.tablename AND c.column_name = 'tenant_id'
      WHERE p.schemaname = 'public' AND 'public' = ANY (p.roles)`
  );
  assert.deepEqual(rows, []);
});

test('R-06: la 0037 elimina la tenant_isolation_* heredada si hay canónica y restringe la que es única', opts, async (t) => {
  const { pool } = fabricasPg(t, url);
  // Tabla propia de la prueba: no toca las políticas de las tablas reales, que otras pruebas usan en paralelo.
  const tabla = `legado_1468_${crypto.randomBytes(4).toString('hex')}`;
  const otra = `${tabla}_sola`;

  try {
    for (const nombre of [tabla, otra]) {
      await pool.query(`CREATE TABLE ${nombre} (id uuid PRIMARY KEY, tenant_id uuid NOT NULL)`);
      await pool.query(`ALTER TABLE ${nombre} ENABLE ROW LEVEL SECURITY`);
      // Como las de ADR-0018 creadas a mano en QA: sin cláusula TO, es decir, TO public.
      await pool.query(
        `CREATE POLICY tenant_isolation_${nombre} ON ${nombre} USING (tenant_id = (auth.jwt() -> 'app_metadata' ->> 'tenant_id')::uuid)`
      );
    }
    await pool.query(`CREATE POLICY ${tabla}_tenant ON ${tabla} FOR ALL TO mani_core_svc USING (tenant_id = app.tenant_id())`);

    await pool.query(fs.readFileSync(MIGRACION_0037, 'utf8'));

    const { rows } = await pool.query(
      'SELECT tablename, policyname, roles::text[] AS roles FROM pg_policies WHERE tablename IN ($1, $2) ORDER BY tablename, policyname',
      [tabla, otra]
    );
    assert.deepEqual(rows, [
      { tablename: tabla, policyname: `${tabla}_tenant`, roles: ['mani_core_svc'] },
      { tablename: otra, policyname: `tenant_isolation_${otra}`, roles: ['authenticated', 'mani_core_svc'] },
    ]);
  } finally {
    await pool.query(`DROP TABLE IF EXISTS ${tabla}, ${otra}`);
  }
});

test('R-06: la 0038 retira la política TO public que la 0004 deja en documento_legal', opts, async (t) => {
  const { pool } = fabricasPg(t, url);
  const heredada = 'Lectura de documentos legales del tenant o globales';

  try {
    // Solo existe donde hay auth.jwt(), como en QA. USING (false) para no ampliar lo que ven las pruebas en paralelo.
    await pool.query(`DROP POLICY IF EXISTS "${heredada}" ON documento_legal`);
    await pool.query(`CREATE POLICY "${heredada}" ON documento_legal FOR SELECT USING (false)`);

    await pool.query(fs.readFileSync(MIGRACION_0038, 'utf8'));

    const { rows } = await pool.query(
      `SELECT policyname FROM pg_policies WHERE tablename = 'documento_legal' AND policyname IN ($1, 'documento_legal_lectura')`,
      [heredada]
    );
    assert.deepEqual(rows, [{ policyname: 'documento_legal_lectura' }]);
  } finally {
    await pool.query(`DROP POLICY IF EXISTS "${heredada}" ON documento_legal`);
  }
});
