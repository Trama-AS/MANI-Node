// Verifica las lecturas del formulario de solicitud (SCRUM-1465) contra PostgreSQL real con el esquema oficial.
// Se omite sin TEST_DATABASE_URL; en CI corre siempre. Preparación local: PostgreSQL 15 vacío y
// scripts/preparar-base-pruebas.sh <MANI-APIGateway/database/migrations> (migraciones 001-008 y db/migrations).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgRequestFormRepository = require('../../../src/infrastructure/repositories/PgRequestFormRepository');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };

const uuid = () => crypto.randomUUID();

// Tenant con dos clientes (persona natural y empresa), categorías activa e inactiva y una jerarquía de zonas.
async function seed(pool) {
  const s = { tenant: uuid(), padre: uuid(), zona: uuid(), activa: uuid(), inactiva: uuid(), natural: uuid(), empresa: uuid() };
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [s.tenant, `t-${s.tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, zona_padre_id, estado) VALUES ($1, 'CIUDAD', 'Bogotá', NULL, 'ACTIVO')", [s.padre]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, zona_padre_id, estado) VALUES ($1, 'LOCALIDAD', 'Chapinero', $2, 'ACTIVO')", [s.zona, s.padre]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'plomería', 'ACTIVO')", [s.activa, s.tenant]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Pintura', 'INACTIVO')", [s.inactiva, s.tenant]);
  for (const [cliente, tipo, clave] of [[s.natural, 'PERSONA_NATURAL', 'usuarioNatural'], [s.empresa, 'PERSONA_JURIDICA', 'usuarioEmpresa']]) {
    s[clave] = uuid();
    await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVO')", [s[clave], s.tenant, `${s[clave]}@t.test`]);
    await pool.query('INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, $4)', [cliente, s.tenant, s[clave], tipo]);
  }
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 45 # 7-10')", [uuid(), s.tenant, s.natural, s.zona]);
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion, nombre) VALUES ($1, $2, $3, $4, 'Calle 100 # 10-20', 'Sede Norte')", [uuid(), s.tenant, s.empresa, s.zona]);
  return s;
}

test('PG formulario: categorías activas del tenant y sitios propios, también para persona natural', opts, async (t) => {
  const factory = new PgPoolFactory({ databaseUrl: url });
  t.after(() => factory.close());
  const pool = factory.getPool();
  const repo = new PgRequestFormRepository({ pgPoolFactory: factory });
  const s = await seed(pool);
  const otro = await seed(pool);

  const natural = { tenantId: s.tenant, userId: s.usuarioNatural, role: 'CLIENT' };
  const categorias = await repo.listarCategorias(natural);
  assert.deepEqual(categorias.map((c) => c.id), [s.activa]);

  const sitios = await repo.listarSitios(natural);
  assert.equal(sitios.length, 1);
  assert.deepEqual(
    { nombre: sitios[0].nombre, zona: sitios[0].zona, zonaPadre: sitios[0].zonaPadre },
    { nombre: 'Calle 45 # 7-10', zona: 'Chapinero', zonaPadre: 'Bogotá' }
  );

  const deEmpresa = await repo.listarSitios({ tenantId: s.tenant, userId: s.usuarioEmpresa, role: 'CLIENT' });
  assert.deepEqual(deEmpresa.map((x) => x.nombre), ['Sede Norte']);

  // El mismo usuario con el tenant de otra empresa en el token no es cliente allí.
  await assert.rejects(repo.listarSitios({ tenantId: otro.tenant, userId: s.usuarioNatural, role: 'CLIENT' }), {
    code: 'MANI-SOL-403C',
  });
});
