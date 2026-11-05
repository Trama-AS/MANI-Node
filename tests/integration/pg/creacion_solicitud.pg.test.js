// US-04.1.1-M2 (SCRUM-1397) y HU-M05-09 (SCRUM-1405): creación idempotente de la solicitud contra PostgreSQL real.
// Se omite sin TEST_DATABASE_URL; en CI corre siempre. Preparación local: PostgreSQL 15 vacío y
// scripts/preparar-base-pruebas.sh <MANI-APIGateway/database/migrations> (migraciones 001-008 y db/migrations).
//
// El caso de uso y el repositorio corren como `mani_core_svc` (NOBYPASSRLS), el rol de Core en QA; la siembra y
// las verificaciones de conteo usan el rol dueño.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgServiceRequestRepository = require('../../../src/infrastructure/repositories/PgServiceRequestRepository');
const CreateServiceRequestUseCase = require('../../../src/application/useCases/requests/CreateServiceRequestUseCase');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };

const uuid = () => crypto.randomUUID();
const comoCore = (u) => `${u}${u.includes('?') ? '&' : '?'}options=-c%20role%3Dmani_core_svc`;
const descripcion = 'Fuga de agua en el baño principal desde ayer';

function entorno(t) {
  const admin = new PgPoolFactory({ databaseUrl: url });
  const core = new PgPoolFactory({ databaseUrl: comoCore(url) });
  t.after(() => Promise.all([admin.close(), core.close()]));
  const repo = new PgServiceRequestRepository({ pgPoolFactory: core });
  const borradas = [];
  const useCase = new CreateServiceRequestUseCase({
    serviceRequestRepository: repo,
    fileStorageService: { upload: async ({ path }) => ({ path }), delete: async (path) => { borradas.push(path); } },
  });
  return { pool: admin.getPool(), repo, useCase, borradas };
}

async function seedTenant(pool) {
  const s = { tenant: uuid(), zona: uuid(), categoria: uuid(), usuario: uuid(), cliente: uuid(), sitio: uuid() };
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [s.tenant, `t-${s.tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, estado) VALUES ($1, 'CIUDAD', 'Bogotá', 'ACTIVO')", [s.zona]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Plomeria', 'ACTIVO')", [s.categoria, s.tenant]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVO')", [s.usuario, s.tenant, `${s.usuario}@t.test`]);
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [s.cliente, s.tenant, s.usuario]);
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1')", [s.sitio, s.tenant, s.cliente, s.zona]);
  s.user = { tenantId: s.tenant, userId: s.usuario, role: 'CLIENT' };
  s.body = { categoriaId: s.categoria, descripcion, sitioId: s.sitio };
  return s;
}

const filasConClave = async (pool, tenant, clave) =>
  (await pool.query('SELECT id, huella_idempotencia FROM solicitud WHERE tenant_id = $1 AND clave_idempotencia = $2', [tenant, clave])).rows;

test('PG creación (1397-C1): la solicitud creada queda PENDIENTE y el cliente la encuentra en su seguimiento', opts, async (t) => {
  const { pool, repo, useCase } = entorno(t);
  const s = await seedTenant(pool);

  const { solicitud, creada } = await useCase.execute({ user: s.user, body: s.body });

  assert.equal(creada, true);
  assert.equal(solicitud.estado, 'PENDIENTE');
  const lista = await repo.listarDelCliente(s.user);
  assert.deepEqual(lista.map((x) => x.id), [solicitud.id]);
});

test('PG idempotencia (1405-C1/C2): la misma clave con los mismos datos devuelve la misma fila; con otros datos 409K', opts, async (t) => {
  const { pool, useCase } = entorno(t);
  const s = await seedTenant(pool);
  const clave = uuid();

  const primera = await useCase.execute({ user: s.user, body: s.body, idempotencyKey: clave });
  const reintento = await useCase.execute({ user: s.user, body: { ...s.body, claveIdempotencia: clave } });

  assert.equal(primera.creada, true);
  assert.equal(reintento.creada, false);
  assert.equal(reintento.solicitud.id, primera.solicitud.id);
  const filas = await filasConClave(pool, s.tenant, clave);
  assert.equal(filas.length, 1);
  assert.match(filas[0].huella_idempotencia, /^[0-9a-f]{64}$/);

  await assert.rejects(
    () => useCase.execute({ user: s.user, body: { ...s.body, descripcion: `${descripcion} y también en la cocina` }, idempotencyKey: clave }),
    (err) => err.statusCode === 409 && err.code === 'MANI-SOL-409K'
  );
  assert.equal((await filasConClave(pool, s.tenant, clave)).length, 1, 'el conflicto no crea ni cambia filas');
});

test('PG idempotencia (1405-C1): cinco envíos simultáneos con la misma clave crean una sola solicitud', opts, async (t) => {
  const { pool, useCase } = entorno(t);
  const s = await seedTenant(pool);
  const clave = uuid();

  const resultados = await Promise.all(
    Array.from({ length: 5 }, () => useCase.execute({ user: s.user, body: s.body, idempotencyKey: clave }))
  );

  assert.equal(resultados.filter((r) => r.creada).length, 1);
  assert.equal(new Set(resultados.map((r) => r.solicitud.id)).size, 1);
  assert.equal((await filasConClave(pool, s.tenant, clave)).length, 1);
});

test('PG idempotencia: la clave es por cliente y tenant; otro tenant con la misma clave crea la suya y no ve la ajena', opts, async (t) => {
  const { pool, repo, useCase } = entorno(t);
  const a = await seedTenant(pool);
  const b = await seedTenant(pool);
  const clave = uuid();

  const deA = await useCase.execute({ user: a.user, body: a.body, idempotencyKey: clave });
  const deB = await useCase.execute({ user: b.user, body: b.body, idempotencyKey: clave });

  assert.equal(deB.creada, true);
  assert.notEqual(deB.solicitud.id, deA.solicitud.id);
  assert.equal(await repo.obtenerDelCliente(b.user, deA.solicitud.id), null, 'lectura cruzada entre tenants');
  assert.equal(await repo.obtenerDelCliente({ ...b.user, tenantId: a.tenant }, deA.solicitud.id), null, 'un usuario de B con el tenant de A');
});
