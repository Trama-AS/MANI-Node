// Verifica la consulta del log del servicio por el cliente (SCRUM-870) contra PostgreSQL real con el esquema
// oficial. Se omite sin TEST_DATABASE_URL; en CI corre siempre. Preparación local: PostgreSQL 15 vacío y
// scripts/preparar-base-pruebas.sh <MANI-APIGateway/database/migrations> (migraciones 001-008 y db/migrations).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgServiceEventRepository = require('../../../src/infrastructure/repositories/PgServiceEventRepository');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };

const uuid = () => crypto.randomUUID();

async function addUsuario(pool, tenant, rol) {
  const id = uuid();
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, $4, 'ACTIVO')", [id, tenant, `${id}@t.test`, rol]);
  return id;
}

// Tenant con dos clientes y una solicitud EN_EJECUCION del primero, asignada a un aliado.
async function seed(pool) {
  const s = { tenant: uuid(), zona: uuid(), categoria: uuid(), sitio: uuid(), solicitud: uuid(), cliente: uuid(), cliente2: uuid(), aliado: uuid() };
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [s.tenant, `t-${s.tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, zona_padre_id, estado) VALUES ($1, 'LOCALIDAD', 'Loc', NULL, 'ACTIVO')", [s.zona]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Plomeria', 'ACTIVO')", [s.categoria, s.tenant]);
  for (const [cliente, clave] of [[s.cliente, 'usuarioCliente'], [s.cliente2, 'usuarioCliente2']]) {
    s[clave] = await addUsuario(pool, s.tenant, 'CLIENTE');
    await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [cliente, s.tenant, s[clave]]);
  }
  s.usuarioAliado = await addUsuario(pool, s.tenant, 'ALIADO');
  await pool.query(
    "INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'A', 'VERIFICADO')",
    [s.aliado, s.tenant, s.usuarioAliado]
  );
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1')", [s.sitio, s.tenant, s.cliente, s.zona]);
  await pool.query(
    "INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, aliado_id, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, 'EN_EJECUCION')",
    [s.solicitud, s.tenant, s.cliente, s.sitio, s.categoria, s.zona, s.aliado]
  );
  return s;
}

test('PG log del cliente: secuencia ordenada al recargar, evidencia solo para el dueño, 404 para ajenos', opts, async (t) => {
  const factory = new PgPoolFactory({ databaseUrl: url });
  t.after(() => factory.close());
  const pool = factory.getPool();
  const repo = new PgServiceEventRepository({ pgPoolFactory: factory });
  const s = await seed(pool);
  const aliado = { tenantId: s.tenant, userId: s.usuarioAliado, role: 'ALLY' };
  const cliente = { tenantId: s.tenant, userId: s.usuarioCliente, role: 'CLIENT' };
  const evento = (extra) => ({ solicitudId: s.solicitud, tipo: 'EJECUCION_AVANCE', observacion: 'Avance', evidenciaRuta: null, claveIdempotencia: null, ...extra });

  const conFoto = await repo.registrar(aliado, evento({ evidenciaRuta: `${s.tenant}/${s.usuarioAliado}/eventos/${s.solicitud}/f.png` }));
  const sinFoto = await repo.registrar(aliado, evento({ tipo: 'EJECUCION_NOVEDAD', observacion: 'Novedad' }));

  // C1: la secuencia se ve igual al volver a consultar.
  const primera = await repo.listar(cliente, s.solicitud);
  const segunda = await repo.listar(cliente, s.solicitud);
  assert.deepEqual(primera.map((e) => e.id), [conFoto.evento.id, sinFoto.evento.id]);
  assert.deepEqual(segunda, primera);

  assert.equal(await repo.rutaEvidencia(cliente, s.solicitud, conFoto.evento.id), `${s.tenant}/${s.usuarioAliado}/eventos/${s.solicitud}/f.png`);
  await assert.rejects(repo.rutaEvidencia(cliente, s.solicitud, sinFoto.evento.id), { code: 'MANI-EVT-404E' });

  // C2: servicio inexistente; C3: otro cliente del tenant y otro tenant.
  await assert.rejects(repo.listar(cliente, uuid()), { code: 'MANI-EVT-404' });
  const ajeno = { ...cliente, userId: s.usuarioCliente2 };
  await assert.rejects(repo.listar(ajeno, s.solicitud), { code: 'MANI-EVT-404' });
  await assert.rejects(repo.rutaEvidencia(ajeno, s.solicitud, conFoto.evento.id), { code: 'MANI-EVT-404' });
  const otro = await seed(pool);
  await assert.rejects(repo.listar({ tenantId: otro.tenant, userId: otro.usuarioCliente, role: 'CLIENT' }, s.solicitud), { code: 'MANI-EVT-404' });

  // Un evento de otra solicitud no se alcanza por esta ruta aunque el cliente sea dueño de ambas.
  await assert.rejects(repo.rutaEvidencia({ tenantId: otro.tenant, userId: otro.usuarioCliente, role: 'CLIENT' }, otro.solicitud, conFoto.evento.id), {
    code: 'MANI-EVT-404E',
  });
});
