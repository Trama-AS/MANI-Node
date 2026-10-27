// HU-M07-04 (SCRUM-871): seguimiento del cliente contra PostgreSQL real con el esquema oficial.
// Se omite sin TEST_DATABASE_URL; en CI corre siempre. Preparación local: PostgreSQL 15 vacío y
// scripts/preparar-base-pruebas.sh <MANI-APIGateway/database/migrations> (migraciones 001-008 y db/migrations).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgServiceRequestRepository = require('../../../src/infrastructure/repositories/PgServiceRequestRepository');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };

const uuid = () => crypto.randomUUID();

async function seedTenant(pool) {
  const s = { tenant: uuid(), padre: uuid(), zona: uuid(), categoria: uuid() };
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [s.tenant, `t-${s.tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, zona_padre_id, estado) VALUES ($1, 'CIUDAD', 'Bogotá', NULL, 'ACTIVO')", [s.padre]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, zona_padre_id, estado) VALUES ($1, 'LOCALIDAD', 'Chapinero', $2, 'ACTIVO')", [s.zona, s.padre]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Plomeria', 'ACTIVO')", [s.categoria, s.tenant]);
  return s;
}

async function addCliente(pool, s) {
  const usuario = uuid();
  const cliente = uuid();
  const sitio = uuid();
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVO')", [usuario, s.tenant, `${usuario}@t.test`]);
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [cliente, s.tenant, usuario]);
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1')", [sitio, s.tenant, cliente, s.zona]);
  return { usuario, cliente, sitio };
}

async function addSolicitud(pool, s, c, { estado = 'PENDIENTE', actualizada = 'now()' } = {}) {
  const id = uuid();
  await pool.query(
    `INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, estado, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, ${actualizada})`,
    [id, s.tenant, c.cliente, c.sitio, s.categoria, s.zona, estado]
  );
  return id;
}

test('PG seguimiento: el cliente ve solo sus solicitudes, con estado y zona declarada, sin cruzar clientes ni tenants', opts, async (t) => {
  const factory = new PgPoolFactory({ databaseUrl: url });
  t.after(() => factory.close());
  const pool = factory.getPool();
  const repo = new PgServiceRequestRepository({ pgPoolFactory: factory });

  const s = await seedTenant(pool);
  const ana = await addCliente(pool, s);
  const vieja = await addSolicitud(pool, s, ana, { actualizada: "now() - interval '1 day'" });
  const asignada = await addSolicitud(pool, s, ana, { estado: 'ASIGNADA' });
  const beto = await addCliente(pool, s);
  const deBeto = await addSolicitud(pool, s, beto);
  const otro = await seedTenant(pool);
  const deOtroTenant = await addSolicitud(pool, otro, await addCliente(pool, otro));

  const ctxAna = { tenantId: s.tenant, userId: ana.usuario, role: 'CLIENT' };
  const lista = await repo.listarDelCliente(ctxAna);

  // C1: solo las de Ana, la más reciente primero, con la zona declarada y su zona padre.
  assert.deepEqual(lista.map((x) => x.id), [asignada, vieja]);
  assert.equal(lista[0].estado, 'ASIGNADA');
  assert.equal(lista[0].categoria, 'Plomeria');
  assert.deepEqual(lista[0].zonaDeclarada, { nombre: 'Chapinero', nivel: 'LOCALIDAD', zonaPadre: 'Bogotá' });
  assert.ok(lista[0].actualizadaEn instanceof Date);

  assert.equal((await repo.obtenerDelCliente(ctxAna, asignada)).id, asignada);
  // C3: la de otro cliente del mismo tenant y la de otro tenant no se ven, ni por listado ni por id.
  assert.equal(await repo.obtenerDelCliente(ctxAna, deBeto), null);
  assert.equal(await repo.obtenerDelCliente(ctxAna, deOtroTenant), null);
  // El tenant del token manda: el mismo usuario con otro tenant no ve nada.
  assert.deepEqual(await repo.listarDelCliente({ ...ctxAna, tenantId: otro.tenant }), []);
});
