// SCRUM-1380: cobertura y categorías del aliado contra PostgreSQL real con el esquema oficial y la migración 0024.
// Se omite sin TEST_DATABASE_URL; en CI corre siempre. Preparación local: PostgreSQL 15 vacío y
// scripts/preparar-base-pruebas.sh <MANI-APIGateway/database/migrations> (migraciones 001-008 y db/migrations).
//
// Core corre como `mani_core_svc` (NOBYPASSRLS): la prueba cubre también el GRANT y la política RLS. La siembra y los
// conteos usan el rol dueño.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgCoberturaRepository = require('../../../src/infrastructure/repositories/PgCoberturaRepository');
const TransactionalAliadoCategoriaRepository = require('../../../src/infrastructure/repositories/TransactionalAliadoCategoriaRepository');
const DeclareAllyCoverageUseCase = require('../../../src/application/useCases/profiles/DeclareAllyCoverageUseCase');
const GetAllyCoverageUseCase = require('../../../src/application/useCases/profiles/GetAllyCoverageUseCase');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };

const uuid = () => crypto.randomUUID();
const comoRol = (u, rol) => `${u}${u.includes('?') ? '&' : '?'}options=-c%20role%3D${rol}`;

function entorno(t) {
  const admin = new PgPoolFactory({ databaseUrl: url });
  const core = new PgPoolFactory({ databaseUrl: comoRol(url, 'mani_core_svc') });
  t.after(() => Promise.all([admin.close(), core.close()]));
  const cobertura = new PgCoberturaRepository({ pgPoolFactory: core });
  return {
    pool: admin.getPool(),
    corePool: core.getPool(),
    cobertura,
    declarar: new DeclareAllyCoverageUseCase({ coberturaRepository: cobertura }),
    obtener: new GetAllyCoverageUseCase({ coberturaRepository: cobertura }),
    categorias: new TransactionalAliadoCategoriaRepository({ pgPoolFactory: core, delegate: {} }),
  };
}

async function addTenant(pool) {
  const id = uuid();
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [id, `t-${id}`]);
  return id;
}

async function addUsuario(pool, tenant, rol, estado = 'ACTIVO') {
  const id = uuid();
  await pool.query('INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, $4, $5)', [id, tenant, `${id}@t.test`, rol, estado]);
  return id;
}

async function addAliado(pool, tenant, estadoVerificacion = 'VERIFICADO') {
  const usuario = await addUsuario(pool, tenant, 'ALIADO');
  const id = uuid();
  await pool.query(
    "INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'A', $4)",
    [id, tenant, usuario, estadoVerificacion]
  );
  return { id, user: { tenantId: tenant, userId: usuario, role: 'ALLY' } };
}

async function addZona(pool, { nivel = 'LOCALIDAD', padre = null, estado = 'ACTIVO', nombre = 'Zona' } = {}) {
  const id = uuid();
  await pool.query('INSERT INTO zona (id, nivel, nombre, zona_padre_id, estado) VALUES ($1, $2, $3, $4, $5)', [id, nivel, nombre, padre, estado]);
  return id;
}

const addCategoria = async (pool, tenant, estado = 'ACTIVO') => {
  const id = uuid();
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, $4, $3)", [id, tenant, estado, `Cat-${id}`]);
  return id;
};
const filas = async (pool, sql, params) => (await pool.query(sql, params)).rows;
const ids = (r) => r.zoneIds.slice().sort();

test('PG cobertura: declarar → obtener; reemplaza el conjunto; repetir el PUT deja el mismo estado', opts, async (t) => {
  const e = entorno(t);
  const tenant = await addTenant(e.pool);
  const aliado = await addAliado(e.pool, tenant);
  const [z1, z2, z3] = [await addZona(e.pool), await addZona(e.pool), await addZona(e.pool)];

  assert.deepEqual((await e.obtener.execute({ user: aliado.user })).zones, []);

  const primero = await e.declarar.execute({ user: aliado.user, zoneIds: [z1, z2, z1] });
  assert.deepEqual(ids(primero), [z1, z2].sort());
  assert.equal(primero.zones[0].active, true);

  const repetido = await e.declarar.execute({ user: aliado.user, zoneIds: [z2, z1] });
  assert.deepEqual(ids(repetido), [z1, z2].sort());
  assert.equal((await filas(e.pool, 'SELECT 1 FROM cobertura_aliado WHERE aliado_id = $1', [aliado.id])).length, 2);

  const reemplazo = await e.declarar.execute({ user: aliado.user, zoneIds: [z3] });
  assert.deepEqual(ids(reemplazo), [z3]);
  assert.deepEqual(ids(await e.obtener.execute({ user: aliado.user })), [z3]);
});

test('PG cobertura: una zona inexistente o desactivada responde 422Z y no cambia nada (rollback)', opts, async (t) => {
  const e = entorno(t);
  const tenant = await addTenant(e.pool);
  const aliado = await addAliado(e.pool, tenant);
  const buena = await addZona(e.pool);
  const inactiva = await addZona(e.pool, { estado: 'INACTIVO' });
  await e.declarar.execute({ user: aliado.user, zoneIds: [buena] });

  for (const malo of [inactiva, uuid(), 'no-es-uuid']) {
    await assert.rejects(
      e.declarar.execute({ user: aliado.user, zoneIds: [await addZona(e.pool), malo] }),
      (err) => err.code === 'MANI-COB-422Z' && err.statusCode === 422
    );
  }
  assert.deepEqual(ids(await e.obtener.execute({ user: aliado.user })), [buena]);
});

test('PG cobertura: una zona desactivada después de declararla sigue visible con active=false', opts, async (t) => {
  const e = entorno(t);
  const tenant = await addTenant(e.pool);
  const aliado = await addAliado(e.pool, tenant);
  const zona = await addZona(e.pool);
  await e.declarar.execute({ user: aliado.user, zoneIds: [zona] });
  await e.pool.query("UPDATE zona SET estado = 'INACTIVO' WHERE id = $1", [zona]);
  const r = await e.obtener.execute({ user: aliado.user });
  assert.deepEqual(r.zones.map((z) => [z.id, z.active]), [[zona, false]]);
});

test('PG cobertura: selección vacía y más de 200 zonas se rechazan antes de tocar la base', opts, async (t) => {
  const e = entorno(t);
  const tenant = await addTenant(e.pool);
  const aliado = await addAliado(e.pool, tenant);
  const zona = await addZona(e.pool);
  await e.declarar.execute({ user: aliado.user, zoneIds: [zona] });

  await assert.rejects(e.declarar.execute({ user: aliado.user, zoneIds: [] }), (err) => err.code === 'MANI-COB-422V');
  await assert.rejects(e.declarar.execute({ user: aliado.user, zoneIds: undefined }), (err) => err.code === 'MANI-COB-422V');
  const muchas = Array.from({ length: 201 }, () => uuid());
  await assert.rejects(e.declarar.execute({ user: aliado.user, zoneIds: muchas }), (err) => err.code === 'MANI-COB-422L');
  assert.deepEqual(ids(await e.obtener.execute({ user: aliado.user })), [zona]);
});

test('PG cobertura: aliado rechazado 403R; cliente, admin y usuario inactivo 403', opts, async (t) => {
  const e = entorno(t);
  const tenant = await addTenant(e.pool);
  const zona = await addZona(e.pool);
  const rechazado = await addAliado(e.pool, tenant, 'RECHAZADO');
  await assert.rejects(e.declarar.execute({ user: rechazado.user, zoneIds: [zona] }), (err) => err.code === 'MANI-COB-403R' && err.statusCode === 403);

  // El caso de uso ya corta por rol; el repositorio también responde 403 si la cuenta no es un aliado activo.
  const cliente = { tenantId: tenant, userId: await addUsuario(e.pool, tenant, 'CLIENTE'), role: 'ALLY' };
  await assert.rejects(e.cobertura.declarar(cliente, [zona]), (err) => err.code === 'MANI-COB-403');
  await assert.rejects(e.obtener.execute({ user: { ...cliente, role: 'CLIENT' } }), (err) => err.code === 'MANI-COB-403');
  await assert.rejects(e.obtener.execute({ user: { ...cliente, role: 'ADMIN' } }), (err) => err.code === 'MANI-COB-403');

  const inactivo = await addAliado(e.pool, tenant);
  await e.pool.query("UPDATE usuario SET estado = 'INACTIVO' WHERE id = $1", [inactivo.user.userId]);
  await assert.rejects(e.declarar.execute({ user: inactivo.user, zoneIds: [zona] }), (err) => err.code === 'MANI-COB-403');
});

test('PG cobertura: aislamiento por tenant — otro tenant no ve ni toca la cobertura, aunque use el mismo usuario', opts, async (t) => {
  const e = entorno(t);
  const tenantA = await addTenant(e.pool);
  const tenantB = await addTenant(e.pool);
  const zona = await addZona(e.pool);
  const a = await addAliado(e.pool, tenantA);
  const b = await addAliado(e.pool, tenantB);
  await e.declarar.execute({ user: a.user, zoneIds: [zona] });

  assert.deepEqual((await e.obtener.execute({ user: b.user })).zones, []);
  // Un JWT con el usuario de A pero el tenant de B no encuentra perfil de aliado en B.
  await assert.rejects(e.obtener.execute({ user: { ...a.user, tenantId: tenantB } }), (err) => err.code === 'MANI-COB-403');
  await assert.rejects(e.declarar.execute({ user: { ...a.user, tenantId: tenantB }, zoneIds: [zona] }), (err) => err.code === 'MANI-COB-403');

  await e.declarar.execute({ user: b.user, zoneIds: [zona] });
  assert.equal((await filas(e.pool, 'SELECT 1 FROM cobertura_aliado WHERE zona_id = $1', [zona])).length, 2);
  assert.deepEqual(ids(await e.obtener.execute({ user: a.user })), [zona]);
});

test('PG cobertura: como mani_core_svc sin contexto la RLS oculta las filas; el disparador y el índice única se aplican', opts, async (t) => {
  const e = entorno(t);
  const tenant = await addTenant(e.pool);
  const otro = await addTenant(e.pool);
  const aliado = await addAliado(e.pool, tenant);
  const zona = await addZona(e.pool);
  await e.declarar.execute({ user: aliado.user, zoneIds: [zona] });

  const sinContexto = await e.corePool.query('SELECT count(*)::int AS n FROM cobertura_aliado');
  assert.equal(sinContexto.rows[0].n, 0, 'sin app.tenant_id la política tenant_id = app.tenant_id() no devuelve filas');

  await assert.rejects(
    e.pool.query('INSERT INTO cobertura_aliado (tenant_id, aliado_id, zona_id) VALUES ($1, $2, $3)', [tenant, aliado.id, zona]),
    (err) => err.code === '23505'
  );
  await assert.rejects(
    e.pool.query('INSERT INTO cobertura_aliado (tenant_id, aliado_id, zona_id) VALUES ($1, $2, $3)', [otro, aliado.id, await addZona(e.pool)]),
    (err) => err.code === 'P0001' && /MANI-COB-422Z/.test(err.message)
  );
});

test('PG cobertura: dos guardados simultáneos del mismo aliado se serializan y terminan en uno de los dos conjuntos', opts, async (t) => {
  const e = entorno(t);
  const tenant = await addTenant(e.pool);
  const aliado = await addAliado(e.pool, tenant);
  const [z1, z2, z3] = [await addZona(e.pool), await addZona(e.pool), await addZona(e.pool)];
  await Promise.all([
    e.declarar.execute({ user: aliado.user, zoneIds: [z1, z2] }),
    e.declarar.execute({ user: aliado.user, zoneIds: [z2, z3] }),
  ]);
  const final = ids(await e.obtener.execute({ user: aliado.user }));
  assert.ok([[z1, z2].sort(), [z2, z3].sort()].some((c) => JSON.stringify(c) === JSON.stringify(final)), `conjunto mezclado: ${final}`);
});

test('PG categorías: el guardado corre en contexto de tenant como mani_core_svc y reemplaza el conjunto', opts, async (t) => {
  const e = entorno(t);
  const tenant = await addTenant(e.pool);
  const aliado = await addAliado(e.pool, tenant);
  const [c1, c2] = [await addCategoria(e.pool, tenant), await addCategoria(e.pool, tenant)];
  const ctx = { userId: aliado.user.userId, role: 'ALLY' };

  assert.deepEqual((await e.categorias.setAliadoCategorias(tenant, aliado.id, [c1, c2], ctx)).sort(), [c1, c2].sort());
  assert.deepEqual(await e.categorias.setAliadoCategorias(tenant, aliado.id, [c2], ctx), [c2]);
  assert.deepEqual(await e.categorias.setAliadoCategorias(tenant, aliado.id, [c2], ctx), [c2], 'repetir es idempotente');
  assert.equal((await filas(e.pool, 'SELECT 1 FROM aliado_categoria WHERE aliado_id = $1', [aliado.id])).length, 1);
});

test('PG categorías: inactiva, de otro tenant o inexistente → 422C sin cambios; aliado ajeno → 403', opts, async (t) => {
  const e = entorno(t);
  const tenant = await addTenant(e.pool);
  const otro = await addTenant(e.pool);
  const aliado = await addAliado(e.pool, tenant);
  const buena = await addCategoria(e.pool, tenant);
  const inactiva = await addCategoria(e.pool, tenant, 'INACTIVO');
  const ajena = await addCategoria(e.pool, otro);
  const ctx = { userId: aliado.user.userId, role: 'ALLY' };
  await e.categorias.setAliadoCategorias(tenant, aliado.id, [buena], ctx);

  for (const mala of [inactiva, ajena, uuid()]) {
    await assert.rejects(
      e.categorias.setAliadoCategorias(tenant, aliado.id, [buena, mala], ctx),
      (err) => err.code === 'MANI-CAT-422C' && err.statusCode === 422
    );
  }
  assert.deepEqual((await filas(e.pool, 'SELECT categoria_id FROM aliado_categoria WHERE aliado_id = $1', [aliado.id])).map((r) => r.categoria_id), [buena]);

  // El aliado de otro tenant no se puede tocar con el tenant propio: responde como si no fuera aliado.
  const delOtro = await addAliado(e.pool, otro);
  await assert.rejects(
    e.categorias.setAliadoCategorias(tenant, delOtro.id, [buena], { userId: aliado.user.userId, role: 'ALLY' }),
    (err) => err.code === 'MANI-CAT-403'
  );
  assert.equal((await filas(e.pool, 'SELECT 1 FROM aliado_categoria WHERE aliado_id = $1', [delOtro.id])).length, 0);
});
