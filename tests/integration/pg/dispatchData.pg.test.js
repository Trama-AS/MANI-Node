// Verifica las consultas SQL contra PostgreSQL real con el esquema oficial.
// Se omite sin TEST_DATABASE_URL; en CI corre siempre. Preparación local: PostgreSQL 15 vacío y
// scripts/preparar-base-pruebas.sh <MANI-APIGateway/database/migrations> (migraciones 001-008 y db/migrations).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgElegibilidadRepository = require('../../../src/infrastructure/repositories/PgElegibilidadRepository');
const PgSolicitudContextRepository = require('../../../src/infrastructure/repositories/PgSolicitudContextRepository');
const PgNotificacionRepository = require('../../../src/infrastructure/repositories/PgNotificacionRepository');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };

const uuid = () => crypto.randomUUID();

async function seedTenant(pool) {
  const s = { tenant: uuid(), padre: uuid(), zona: uuid(), categoria: uuid(), cliente: uuid(), sitio: uuid() };
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [s.tenant, `t-${s.tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, zona_padre_id, estado) VALUES ($1, 'CIUDAD', 'Padre', NULL, 'ACTIVO')", [s.padre]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, zona_padre_id, estado) VALUES ($1, 'LOCALIDAD', 'Loc', $2, 'ACTIVO')", [s.zona, s.padre]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Plomeria', 'ACTIVO')", [s.categoria, s.tenant]);
  const usuario = uuid();
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVO')", [usuario, s.tenant, `${usuario}@t.test`]);
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [s.cliente, s.tenant, usuario]);
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1')", [s.sitio, s.tenant, s.cliente, s.zona]);
  return s;
}

async function addAliado(pool, s, { nombre, estado = 'VERIFICADO', tipo = 'PERSONA_NATURAL', zona, tenant = s.tenant, categoria = s.categoria }) {
  const usuario = uuid();
  const aliado = uuid();
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'ALIADO', 'ACTIVO')", [usuario, tenant, `${usuario}@t.test`]);
  await pool.query(
    'INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, $4, $5, $6)',
    [aliado, tenant, usuario, tipo, nombre, estado]
  );
  await pool.query('INSERT INTO aliado_categoria (tenant_id, aliado_id, categoria_id) VALUES ($1, $2, $3)', [tenant, aliado, categoria]);
  await pool.query('INSERT INTO cobertura_aliado (tenant_id, aliado_id, zona_id) VALUES ($1, $2, $3)', [tenant, aliado, zona || s.zona]);
  return { aliado, usuario };
}

async function addSolicitud(pool, s) {
  const id = uuid();
  await pool.query(
    "INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, estado) VALUES ($1, $2, $3, $4, $5, $6, 'PENDIENTE')",
    [id, s.tenant, s.cliente, s.sitio, s.categoria, s.zona]
  );
  return id;
}

test('PG elegibilidad: solo aliados VERIFICADOS, sin ausencia vigente ni rechazo, acotado al tenant', opts, async (t) => {
  const factory = new PgPoolFactory({ databaseUrl: url });
  t.after(() => factory.close());
  const pool = factory.getPool();
  const repo = new PgElegibilidadRepository({ pgPoolFactory: factory });
  const s = await seedTenant(pool);
  const solicitud = await addSolicitud(pool, s);

  const ana = await addAliado(pool, s, { nombre: 'Ana' });
  const beto = await addAliado(pool, s, { nombre: 'Beto', tipo: 'PERSONA_JURIDICA' });
  await addAliado(pool, s, { nombre: 'Sin verificar', estado: 'PENDIENTE' });
  const vacaciones = await addAliado(pool, s, { nombre: 'Vacaciones' });
  await pool.query(
    "INSERT INTO aliado_ausencia (tenant_id, aliado_id, inicio, fin, motivo) VALUES ($1, $2, now() - interval '1 day', now() + interval '1 day', 'VACACIONES')",
    [s.tenant, vacaciones.aliado]
  );
  const pasada = await addAliado(pool, s, { nombre: 'Ausencia pasada' });
  await pool.query(
    "INSERT INTO aliado_ausencia (tenant_id, aliado_id, inicio, fin, motivo) VALUES ($1, $2, now() - interval '3 day', now() - interval '2 day', 'VACACIONES')",
    [s.tenant, pasada.aliado]
  );
  const rechazo = await addAliado(pool, s, { nombre: 'Rechazo' });
  await pool.query('INSERT INTO solicitud_rechazo (tenant_id, solicitud_id, aliado_id) VALUES ($1, $2, $3)', [s.tenant, solicitud, rechazo.aliado]);
  const otro = await seedTenant(pool);
  await addAliado(pool, otro, { nombre: 'Otro tenant' });
  await addAliado(pool, s, { nombre: 'Otra zona', zona: otro.zona });

  const base = { tenantId: s.tenant, categoriaId: s.categoria, zonaId: s.zona, page: 1, pageSize: 20 };
  const all = await repo.findEligible(base);
  const names = all.allies.map((a) => a.nombreRazonSocial).sort();
  assert.deepEqual(names, ['Ana', 'Ausencia pasada', 'Beto', 'Rechazo']);
  assert.equal(all.totalCount, 4);
  assert.equal(all.allies.find((a) => a.id === ana.aliado).estadoVerificacion, 'VERIFICADO');

  const conRequest = await repo.findEligible({ ...base, requestId: solicitud });
  assert.deepEqual(conRequest.allies.map((a) => a.nombreRazonSocial).sort(), ['Ana', 'Ausencia pasada', 'Beto']);

  const juridicas = await repo.findEligible({ ...base, tipo: 'PERSONA_JURIDICA' });
  assert.deepEqual(juridicas.allies.map((a) => a.id), [beto.aliado]);

  const pagina = await repo.findEligible({ ...base, pageSize: 2, page: 2 });
  assert.equal(pagina.allies.length, 2);
  assert.equal(pagina.totalCount, 4);

  const fueraDeRango = await repo.findEligible({ ...base, page: 9 });
  assert.deepEqual(fueraDeRango, { allies: [], totalCount: 4 });

  const otroTenant = await repo.findEligible({ ...base, tenantId: otro.tenant });
  assert.equal(otroTenant.totalCount, 0, 'el tenant ajeno no ve aliados con la categoría de otro tenant');

  const eva = await addAliado(pool, s, { nombre: 'Eva', tipo: 'EMPLEADO_DIRECTO' });
  const empleados = await repo.findEligible({ ...base, tipo: 'EMPLEADO_DIRECTO' });
  assert.deepEqual(empleados.allies.map((a) => a.id), [eva.aliado]);
});

test('PG elegibilidad: la cobertura en una zona padre cubre sus descendientes', opts, async (t) => {
  const factory = new PgPoolFactory({ databaseUrl: url });
  t.after(() => factory.close());
  const pool = factory.getPool();
  const repo = new PgElegibilidadRepository({ pgPoolFactory: factory });
  const s = await seedTenant(pool);
  await addAliado(pool, s, { nombre: 'Cubre la ciudad', zona: s.padre });

  const result = await repo.findEligible({ tenantId: s.tenant, categoriaId: s.categoria, zonaId: s.zona, page: 1, pageSize: 20 });

  assert.deepEqual(result.allies.map((a) => a.nombreRazonSocial), ['Cubre la ciudad']);
});

test('PG contexto de solicitud: devuelve zona y categoría solo dentro del tenant', opts, async (t) => {
  const factory = new PgPoolFactory({ databaseUrl: url });
  t.after(() => factory.close());
  const pool = factory.getPool();
  const repo = new PgSolicitudContextRepository({ pgPoolFactory: factory });
  const s = await seedTenant(pool);
  const solicitud = await addSolicitud(pool, s);

  const context = await repo.findContext(s.tenant, solicitud);
  assert.deepEqual(context, { id: solicitud, tenantId: s.tenant, zonaId: s.zona, categoriaId: s.categoria, estado: 'PENDIENTE' });
  assert.equal(await repo.findContext(uuid(), solicitud), null);
  assert.equal(await repo.findContext(s.tenant, uuid()), null);
});

test('PG notificaciones: crea para el usuario del aliado, lista por solicitud y no cruza tenants', opts, async (t) => {
  const factory = new PgPoolFactory({ databaseUrl: url });
  t.after(() => factory.close());
  const pool = factory.getPool();
  const repo = new PgNotificacionRepository({ pgPoolFactory: factory });
  const s = await seedTenant(pool);
  const otro = await seedTenant(pool);
  const solicitud = await addSolicitud(pool, s);
  const ana = await addAliado(pool, s, { nombre: 'Ana' });
  const ajeno = await addAliado(pool, otro, { nombre: 'Ajeno' });
  const payload = { requestId: solicitud, allyId: ana.aliado, estado: 'ENVIADA' };

  const created = await repo.createForAlly({ tenantId: s.tenant, allyId: ana.aliado, tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload });
  assert.ok(created.id);
  assert.equal(created.usuarioId, ana.usuario, 'devuelve el usuario destinatario para la entrega push');
  const row = (await pool.query('SELECT usuario_id, tenant_id FROM notificacion WHERE id = $1', [created.id])).rows[0];
  assert.equal(row.usuario_id, ana.usuario);
  assert.equal(row.tenant_id, s.tenant);

  assert.equal(
    await repo.createForAlly({ tenantId: s.tenant, allyId: ajeno.aliado, tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload }),
    null,
    'un aliado de otro tenant no recibe notificaciones'
  );

  const listed = await repo.listByRequest(s.tenant, solicitud, 'OFERTA_DESPACHO');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].payload.allyId, ana.aliado);
  assert.ok(listed[0].enviadoAt instanceof Date);
  assert.deepEqual(await repo.listByRequest(otro.tenant, solicitud, 'OFERTA_DESPACHO'), []);
});

test('PG bandeja (HU-M09-06): el usuario ve solo sus notificaciones, más recientes primero y sin cruzar tenants', opts, async (t) => {
  const factory = new PgPoolFactory({ databaseUrl: url });
  t.after(() => factory.close());
  const pool = factory.getPool();
  const repo = new PgNotificacionRepository({ pgPoolFactory: factory });
  const s = await seedTenant(pool);
  const otro = await seedTenant(pool);
  const solicitud = await addSolicitud(pool, s);
  const ana = await addAliado(pool, s, { nombre: 'Ana' });
  const beto = await addAliado(pool, s, { nombre: 'Beto' });
  const ajeno = await addAliado(pool, otro, { nombre: 'Ajeno' });
  const send = (tenantId, allyId, n) =>
    repo.createForAlly({ tenantId, allyId, tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload: { requestId: solicitud, n } });

  const primera = await send(s.tenant, ana.aliado, 1);
  await pool.query("UPDATE notificacion SET enviado_at = now() - interval '1 hour' WHERE id = $1", [primera.id]);
  const segunda = await send(s.tenant, ana.aliado, 2);
  await send(s.tenant, beto.aliado, 3);
  await send(otro.tenant, ajeno.aliado, 4);

  const inbox = await repo.listForUser(s.tenant, ana.usuario, { limit: 10 });
  assert.deepEqual(inbox.map((n) => n.id), [segunda.id, primera.id]);
  assert.equal(inbox[0].payload.n, 2);
  assert.equal(inbox[0].leidoAt, null);
  assert.ok(inbox[0].enviadoAt instanceof Date);

  assert.equal((await repo.listForUser(s.tenant, ana.usuario, { limit: 1 })).length, 1);
  assert.deepEqual(await repo.listForUser(otro.tenant, ana.usuario, { limit: 10 }), [], 'el usuario de otro tenant no ve nada');
});

test('PG repositorios: sin DATABASE_URL fallan cerrado con 503', async () => {
  const factory = new PgPoolFactory({ databaseUrl: undefined });
  await assert.rejects(
    () => new PgElegibilidadRepository({ pgPoolFactory: factory }).findEligible({ tenantId: uuid(), page: 1, pageSize: 1 }),
    (err) => err.statusCode === 503
  );
  await assert.rejects(() => new PgSolicitudContextRepository({ pgPoolFactory: factory }).findContext(uuid(), uuid()), (err) => err.statusCode === 503);
  await assert.rejects(() => new PgNotificacionRepository({ pgPoolFactory: factory }).listByRequest(uuid(), uuid(), 'X'), (err) => err.statusCode === 503);
  await assert.rejects(() => new PgNotificacionRepository({ pgPoolFactory: factory }).listForUser(uuid(), uuid(), { limit: 1 }), (err) => err.statusCode === 503);
});
