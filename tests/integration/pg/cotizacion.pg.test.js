// Verifica la cotización (SCRUM-865) contra PostgreSQL real con el esquema oficial.
// Se omite sin TEST_DATABASE_URL; en CI corre siempre. Preparación local: PostgreSQL 15 vacío y
// scripts/preparar-base-pruebas.sh <MANI-APIGateway/database/migrations> (migraciones 001-008 y db/migrations).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgQuoteRepository = require('../../../src/infrastructure/repositories/PgQuoteRepository');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };

const uuid = () => crypto.randomUUID();

async function addUsuario(pool, tenant, rol) {
  const id = uuid();
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, $4, 'ACTIVO')", [id, tenant, `${id}@t.test`, rol]);
  return id;
}

// Tenant con un cliente dueño de una solicitud ASIGNADA a un aliado, otro cliente y otro aliado.
async function seed(pool) {
  const s = { tenant: uuid(), zona: uuid(), categoria: uuid(), sitio: uuid(), solicitud: uuid(), cliente: uuid(), aliado: uuid(), cliente2: uuid(), aliado2: uuid() };
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [s.tenant, `t-${s.tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, zona_padre_id, estado) VALUES ($1, 'LOCALIDAD', 'Loc', NULL, 'ACTIVO')", [s.zona]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Plomeria', 'ACTIVO')", [s.categoria, s.tenant]);
  for (const [cliente, clave] of [[s.cliente, 'usuarioCliente'], [s.cliente2, 'usuarioCliente2']]) {
    s[clave] = await addUsuario(pool, s.tenant, 'CLIENTE');
    await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [cliente, s.tenant, s[clave]]);
  }
  for (const [aliado, clave] of [[s.aliado, 'usuarioAliado'], [s.aliado2, 'usuarioAliado2']]) {
    s[clave] = await addUsuario(pool, s.tenant, 'ALIADO');
    await pool.query(
      "INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'A', 'VERIFICADO')",
      [aliado, s.tenant, s[clave]]
    );
  }
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1')", [s.sitio, s.tenant, s.cliente, s.zona]);
  await pool.query(
    "INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, aliado_id, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ASIGNADA')",
    [s.solicitud, s.tenant, s.cliente, s.sitio, s.categoria, s.zona, s.aliado]
  );
  return s;
}

test('PG cotización: el aliado asignado cotiza, la solicitud pasa a COTIZANDO y solo dueño y aliado la leen', opts, async (t) => {
  const factory = new PgPoolFactory({ databaseUrl: url });
  t.after(() => factory.close());
  const pool = factory.getPool();
  const repo = new PgQuoteRepository({ pgPoolFactory: factory });
  const s = await seed(pool);
  const aliado = { tenantId: s.tenant, userId: s.usuarioAliado, role: 'ALLY' };

  const v1 = await repo.emitir(aliado, { solicitudId: s.solicitud, valorManoObra: 120000, valorMateriales: 35500.5 });
  assert.equal(v1.version, 1);
  assert.equal(v1.estado, 'PENDIENTE');
  assert.equal(v1.total, 155500.5);

  const fila = await pool.query('SELECT estado FROM solicitud WHERE id = $1', [s.solicitud]);
  assert.equal(fila.rows[0].estado, 'COTIZANDO');
  const evento = await pool.query("SELECT actor_id FROM evento_servicio WHERE solicitud_id = $1 AND tipo_evento = 'COTIZACION_ENVIADA'", [s.solicitud]);
  assert.equal(evento.rows[0].actor_id, s.usuarioAliado);

  // Con una pendiente no se emite otra; cuando el cliente pide ajuste (SCRUM-867) sale la versión 2.
  await assert.rejects(repo.emitir(aliado, { solicitudId: s.solicitud, valorManoObra: 1, valorMateriales: 0 }), { code: 'MANI-COT-409P' });
  await pool.query("UPDATE cotizacion SET estado = 'AJUSTE_SOLICITADO' WHERE id = $1", [v1.id]);
  const v2 = await repo.emitir(aliado, { solicitudId: s.solicitud, valorManoObra: 110000, valorMateriales: 35500.5 });
  assert.equal(v2.version, 2);

  const delCliente = await repo.listarPorSolicitud({ tenantId: s.tenant, userId: s.usuarioCliente, role: 'CLIENT' }, s.solicitud);
  assert.deepEqual(delCliente.map((c) => c.version), [2, 1]);
  const delAliado = await repo.listarPorSolicitud(aliado, s.solicitud);
  assert.equal(delAliado.length, 2);

  // C3: otro cliente u otro aliado del mismo tenant no la ven ni cotizan.
  await assert.rejects(repo.listarPorSolicitud({ tenantId: s.tenant, userId: s.usuarioCliente2, role: 'CLIENT' }, s.solicitud), { code: 'MANI-COT-404' });
  await assert.rejects(repo.listarPorSolicitud({ tenantId: s.tenant, userId: s.usuarioAliado2, role: 'ALLY' }, s.solicitud), { code: 'MANI-COT-404' });
  await assert.rejects(
    repo.emitir({ tenantId: s.tenant, userId: s.usuarioAliado2, role: 'ALLY' }, { solicitudId: s.solicitud, valorManoObra: 1, valorMateriales: 0 }),
    { code: 'MANI-COT-403A' }
  );
});

test('PG cotización: otro tenant no ve ni cotiza la solicitud, y un estado incompatible no se cotiza', opts, async (t) => {
  const factory = new PgPoolFactory({ databaseUrl: url });
  t.after(() => factory.close());
  const pool = factory.getPool();
  const repo = new PgQuoteRepository({ pgPoolFactory: factory });
  const s = await seed(pool);
  const otro = await seed(pool);

  // Mismo usuario aliado, pero con el tenant de otra empresa en el token: la solicitud no existe.
  const cruzado = { tenantId: otro.tenant, userId: otro.usuarioAliado, role: 'ALLY' };
  await assert.rejects(repo.emitir(cruzado, { solicitudId: s.solicitud, valorManoObra: 1, valorMateriales: 0 }), { code: 'MANI-COT-404' });
  await assert.rejects(repo.listarPorSolicitud(cruzado, s.solicitud), { code: 'MANI-COT-404' });

  await pool.query("UPDATE solicitud SET estado = 'FINALIZADA' WHERE id = $1", [s.solicitud]);
  await assert.rejects(
    repo.emitir({ tenantId: s.tenant, userId: s.usuarioAliado, role: 'ALLY' }, { solicitudId: s.solicitud, valorManoObra: 1, valorMateriales: 0 }),
    { code: 'MANI-COT-409E' }
  );
  const cotizaciones = await pool.query('SELECT count(*)::int AS n FROM cotizacion WHERE solicitud_id = $1', [s.solicitud]);
  assert.equal(cotizaciones.rows[0].n, 0);
});
