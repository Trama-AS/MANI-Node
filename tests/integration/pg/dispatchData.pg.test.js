// Verifica las consultas SQL de lectura para Dispatch contra PostgreSQL real con el esquema oficial.
// Se omite sin TEST_DATABASE_URL; en CI corre siempre. Preparación local: PostgreSQL 15 vacío y
// scripts/preparar-base-pruebas.sh <MANI-APIGateway/database/migrations> (migraciones 001-008 y db/migrations).
//
// Los repositorios corren como `mani_core_svc` (NOBYPASSRLS), el rol con el que Core se conecta en QA: así
// fallan si una consulta sale sin el contexto del tenant o lee una tabla sin permiso (SCRUM-1398). La siembra
// usa el rol dueño, que no pasa por RLS.
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
const comoCore = (u) => `${u}${u.includes('?') ? '&' : '?'}options=-c%20role%3Dmani_core_svc`;

function entorno(t) {
  const admin = new PgPoolFactory({ databaseUrl: url });
  const core = new PgPoolFactory({ databaseUrl: comoCore(url) });
  t.after(() => Promise.all([admin.close(), core.close()]));
  return { pool: admin.getPool(), core };
}

async function addUsuario(pool, tenant, rol, estado = 'ACTIVO') {
  const id = uuid();
  await pool.query('INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, $4, $5)', [id, tenant, `${id}@t.test`, rol, estado]);
  return id;
}

async function seedTenant(pool) {
  const s = { tenant: uuid(), padre: uuid(), zona: uuid(), categoria: uuid(), cliente: uuid(), sitio: uuid() };
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [s.tenant, `t-${s.tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, zona_padre_id, estado) VALUES ($1, 'CIUDAD', 'Padre', NULL, 'ACTIVO')", [s.padre]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, zona_padre_id, estado) VALUES ($1, 'LOCALIDAD', 'Loc', $2, 'ACTIVO')", [s.zona, s.padre]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Plomeria', 'ACTIVO')", [s.categoria, s.tenant]);
  s.usuarioCliente = await addUsuario(pool, s.tenant, 'CLIENTE');
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [s.cliente, s.tenant, s.usuarioCliente]);
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1')", [s.sitio, s.tenant, s.cliente, s.zona]);
  s.ctxCliente = { tenantId: s.tenant, userId: s.usuarioCliente, role: 'CLIENT' };
  return s;
}

async function addAliado(pool, s, { nombre, estado = 'VERIFICADO', tipo = 'PERSONA_NATURAL', zona, tenant = s.tenant, categoria = s.categoria, estadoUsuario = 'ACTIVO' }) {
  const usuario = await addUsuario(pool, tenant, 'ALIADO', estadoUsuario);
  const aliado = uuid();
  await pool.query(
    'INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, $4, $5, $6)',
    [aliado, tenant, usuario, tipo, nombre, estado]
  );
  await pool.query('INSERT INTO aliado_categoria (tenant_id, aliado_id, categoria_id) VALUES ($1, $2, $3)', [tenant, aliado, categoria]);
  await pool.query('INSERT INTO cobertura_aliado (tenant_id, aliado_id, zona_id) VALUES ($1, $2, $3)', [tenant, aliado, zona || s.zona]);
  return { aliado, usuario, ctx: { tenantId: tenant, userId: usuario, role: 'ALLY' } };
}

async function addSolicitud(pool, s, { aliadoId = null, estado = 'PENDIENTE' } = {}) {
  const id = uuid();
  await pool.query(
    'INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, aliado_id, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [id, s.tenant, s.cliente, s.sitio, s.categoria, s.zona, aliadoId, estado]
  );
  return id;
}

const nombres = (r) => r.allies.map((a) => a.nombreRazonSocial).sort();

test('PG elegibilidad como mani_core_svc: solo VERIFICADOS, activos, sin ausencia vigente, acotado al tenant', opts, async (t) => {
  const { pool, core } = entorno(t);
  const repo = new PgElegibilidadRepository({ pgPoolFactory: core });
  const s = await seedTenant(pool);

  const ana = await addAliado(pool, s, { nombre: 'Ana' });
  const beto = await addAliado(pool, s, { nombre: 'Beto', tipo: 'PERSONA_JURIDICA' });
  await addAliado(pool, s, { nombre: 'Sin verificar', estado: 'PENDIENTE' });
  await addAliado(pool, s, { nombre: 'Cuenta inactiva', estadoUsuario: 'INACTIVO' });
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
  const otro = await seedTenant(pool);
  await addAliado(pool, otro, { nombre: 'Otro tenant' });
  await addAliado(pool, s, { nombre: 'Otra zona', zona: otro.zona });

  const criterios = { categoriaId: s.categoria, zonaId: s.zona, page: 1, pageSize: 20 };
  const todos = await repo.findEligible(s.ctxCliente, criterios);
  assert.deepEqual(nombres(todos), ['Ana', 'Ausencia pasada', 'Beto'], 'con el rol real hay aliados (antes fallaba por solicitud_rechazo)');
  assert.equal(todos.totalCount, 3);
  assert.equal(todos.allies.find((a) => a.id === ana.aliado).estadoVerificacion, 'VERIFICADO');

  const admin = await repo.findEligible({ tenantId: s.tenant, userId: uuid(), role: 'ADMIN' }, criterios);
  assert.equal(admin.totalCount, 3, 'el admin del tenant ve lo mismo');

  const juridicas = await repo.findEligible(s.ctxCliente, { ...criterios, tipo: 'PERSONA_JURIDICA' });
  assert.deepEqual(juridicas.allies.map((a) => a.id), [beto.aliado]);

  const pagina = await repo.findEligible(s.ctxCliente, { ...criterios, pageSize: 2, page: 2 });
  assert.equal(pagina.allies.length, 1);
  assert.equal(pagina.totalCount, 3);
  assert.deepEqual(await repo.findEligible(s.ctxCliente, { ...criterios, page: 9 }), { allies: [], totalCount: 3 });

  const ajeno = await repo.findEligible(otro.ctxCliente, criterios);
  assert.equal(ajeno.totalCount, 0, 'el tenant ajeno no ve aliados con la categoría de otro tenant');

  const eva = await addAliado(pool, s, { nombre: 'Eva', tipo: 'EMPLEADO_DIRECTO' });
  const empleados = await repo.findEligible(s.ctxCliente, { ...criterios, tipo: 'EMPLEADO_DIRECTO' });
  assert.deepEqual(empleados.allies.map((a) => a.id), [eva.aliado]);
});

test('PG elegibilidad: los excluidos (rechazos que envía Dispatch) quedan fuera antes de paginar', opts, async (t) => {
  const { pool, core } = entorno(t);
  const repo = new PgElegibilidadRepository({ pgPoolFactory: core });
  const s = await seedTenant(pool);
  const ana = await addAliado(pool, s, { nombre: 'Ana' });
  const beto = await addAliado(pool, s, { nombre: 'Beto' });
  await addAliado(pool, s, { nombre: 'Caro' });

  const r = await repo.findEligible(s.ctxCliente, {
    categoriaId: s.categoria, zonaId: s.zona, excludeAllyIds: [ana.aliado, beto.aliado, uuid()], page: 1, pageSize: 1,
  });

  assert.deepEqual(nombres(r), ['Caro']);
  assert.equal(r.totalCount, 1, 'el total ya descuenta a los excluidos');
});

test('PG elegibilidad: una categoría o una zona inactiva no devuelve aliados', opts, async (t) => {
  const { pool, core } = entorno(t);
  const repo = new PgElegibilidadRepository({ pgPoolFactory: core });
  const s = await seedTenant(pool);
  await addAliado(pool, s, { nombre: 'Ana' });
  const criterios = { categoriaId: s.categoria, zonaId: s.zona, page: 1, pageSize: 20 };

  await pool.query("UPDATE categoria_servicio SET estado = 'INACTIVO' WHERE id = $1", [s.categoria]);
  assert.equal((await repo.findEligible(s.ctxCliente, criterios)).totalCount, 0);

  await pool.query("UPDATE categoria_servicio SET estado = 'ACTIVO' WHERE id = $1", [s.categoria]);
  await pool.query("UPDATE zona SET estado = 'INACTIVO' WHERE id = $1", [s.zona]);
  assert.equal((await repo.findEligible(s.ctxCliente, criterios)).totalCount, 0);
});

test('PG elegibilidad: la cobertura en una zona padre cubre sus descendientes', opts, async (t) => {
  const { pool, core } = entorno(t);
  const repo = new PgElegibilidadRepository({ pgPoolFactory: core });
  const s = await seedTenant(pool);
  await addAliado(pool, s, { nombre: 'Cubre la ciudad', zona: s.padre });

  const result = await repo.findEligible(s.ctxCliente, { categoriaId: s.categoria, zonaId: s.zona, page: 1, pageSize: 20 });

  assert.deepEqual(nombres(result), ['Cubre la ciudad']);
});

test('PG contexto (SCRUM-1399) como mani_core_svc: solo el admin, el cliente dueño y los aliados implicados', opts, async (t) => {
  const { pool, core } = entorno(t);
  const repo = new PgSolicitudContextRepository({ pgPoolFactory: core });
  const s = await seedTenant(pool);
  const otro = await seedTenant(pool);
  const asignado = await addAliado(pool, s, { nombre: 'Asignado' });
  const ofertado = await addAliado(pool, s, { nombre: 'Con oferta' });
  const sinOferta = await addAliado(pool, s, { nombre: 'Sin oferta' });
  const pendiente = await addSolicitud(pool, s);
  const asignada = await addSolicitud(pool, s, { aliadoId: asignado.aliado, estado: 'ASIGNADA' });
  await pool.query(
    "INSERT INTO notificacion (tenant_id, usuario_id, tipo, canal, payload) VALUES ($1, $2, 'OFERTA_DESPACHO', 'PUSH', $3)",
    [s.tenant, ofertado.usuario, JSON.stringify({ requestId: pendiente })]
  );
  const otroCliente = await addUsuario(pool, s.tenant, 'CLIENTE');
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [uuid(), s.tenant, otroCliente]);

  const esperado = { id: pendiente, tenantId: s.tenant, zonaId: s.zona, categoriaId: s.categoria, estado: 'PENDIENTE', esMia: false };
  assert.deepEqual(await repo.findContext(s.ctxCliente, pendiente), esperado, 'el cliente dueño');
  assert.deepEqual(await repo.findContext({ tenantId: s.tenant, userId: uuid(), role: 'ADMIN' }, pendiente), esperado, 'el admin del tenant');
  assert.deepEqual(await repo.findContext(ofertado.ctx, pendiente), esperado, 'el aliado con oferta propia');
  assert.deepEqual(
    await repo.findContext(asignado.ctx, asignada),
    { id: asignada, tenantId: s.tenant, zonaId: s.zona, categoriaId: s.categoria, estado: 'ASIGNADA', esMia: true },
    'el aliado asignado, con esMia'
  );

  assert.equal(await repo.findContext({ tenantId: s.tenant, userId: otroCliente, role: 'CLIENT' }, pendiente), null, 'otro cliente del tenant');
  assert.equal(await repo.findContext(sinOferta.ctx, pendiente), null, 'un aliado sin oferta');
  assert.equal(await repo.findContext(ofertado.ctx, asignada), null, 'la oferta de otra solicitud no abre esta');
  assert.equal(await repo.findContext(otro.ctxCliente, pendiente), null, 'otro tenant');
  assert.equal(await repo.findContext({ tenantId: otro.tenant, userId: uuid(), role: 'ADMIN' }, pendiente), null, 'el admin de otro tenant');
  assert.equal(await repo.findContext(s.ctxCliente, uuid()), null, 'inexistente');
});

test('PG notificaciones como mani_core_svc: crea para el usuario del aliado, lista por solicitud y no cruza tenants', opts, async (t) => {
  const { pool, core } = entorno(t);
  const repo = new PgNotificacionRepository({ pgPoolFactory: core });
  const s = await seedTenant(pool);
  const otro = await seedTenant(pool);
  const solicitud = await addSolicitud(pool, s);
  const ana = await addAliado(pool, s, { nombre: 'Ana' });
  const ajeno = await addAliado(pool, otro, { nombre: 'Ajeno' });
  const payload = { requestId: solicitud, allyId: ana.aliado, estado: 'ENVIADA' };

  const created = await repo.createForAlly(s.ctxCliente, { allyId: ana.aliado, tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload });
  assert.ok(created.id);
  assert.equal(created.usuarioId, ana.usuario, 'devuelve el usuario destinatario para la entrega push');
  const row = (await pool.query('SELECT usuario_id, tenant_id FROM notificacion WHERE id = $1', [created.id])).rows[0];
  assert.equal(row.usuario_id, ana.usuario);
  assert.equal(row.tenant_id, s.tenant);

  assert.equal(
    await repo.createForAlly(s.ctxCliente, { allyId: ajeno.aliado, tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload }),
    null,
    'un aliado de otro tenant no recibe notificaciones'
  );

  const listed = await repo.listByRequest(s.ctxCliente, solicitud, 'OFERTA_DESPACHO');
  assert.equal(listed.length, 1);
  assert.equal(listed[0].payload.allyId, ana.aliado);
  assert.ok(listed[0].enviadoAt instanceof Date);
  assert.deepEqual(await repo.listByRequest(otro.ctxCliente, solicitud, 'OFERTA_DESPACHO'), []);
});

test('PG bandeja (HU-M09-06) como mani_core_svc: el usuario ve solo las suyas, más recientes primero y sin cruzar tenants', opts, async (t) => {
  const { pool, core } = entorno(t);
  const repo = new PgNotificacionRepository({ pgPoolFactory: core });
  const s = await seedTenant(pool);
  const otro = await seedTenant(pool);
  const solicitud = await addSolicitud(pool, s);
  const ana = await addAliado(pool, s, { nombre: 'Ana' });
  const beto = await addAliado(pool, s, { nombre: 'Beto' });
  const ajeno = await addAliado(pool, otro, { nombre: 'Ajeno' });
  const send = (ctx, allyId, n) =>
    repo.createForAlly(ctx, { allyId, tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload: { requestId: solicitud, n } });

  const primera = await send(s.ctxCliente, ana.aliado, 1);
  await pool.query("UPDATE notificacion SET enviado_at = now() - interval '1 hour' WHERE id = $1", [primera.id]);
  const segunda = await send(s.ctxCliente, ana.aliado, 2);
  await send(s.ctxCliente, beto.aliado, 3);
  await send(otro.ctxCliente, ajeno.aliado, 4);

  const inbox = await repo.listForUser(ana.ctx, { limit: 10 });
  assert.deepEqual(inbox.map((n) => n.id), [segunda.id, primera.id]);
  assert.equal(inbox[0].payload.n, 2);
  assert.equal(inbox[0].leidoAt, null);
  assert.ok(inbox[0].enviadoAt instanceof Date);

  assert.equal((await repo.listForUser(ana.ctx, { limit: 1 })).length, 1);
  assert.deepEqual(await repo.listForUser({ ...ana.ctx, tenantId: otro.tenant }, { limit: 10 }), [], 'con el tenant de otro no ve nada');
});

test('PG repositorios: sin DATABASE_URL fallan cerrado con 503', async () => {
  const factory = new PgPoolFactory({ databaseUrl: undefined });
  const ctx = { tenantId: uuid(), userId: uuid(), role: 'CLIENT' };
  const es503 = (err) => err.statusCode === 503;
  await assert.rejects(
    () => new PgElegibilidadRepository({ pgPoolFactory: factory }).findEligible(ctx, { categoriaId: uuid(), zonaId: uuid(), page: 1, pageSize: 1 }),
    es503
  );
  await assert.rejects(() => new PgSolicitudContextRepository({ pgPoolFactory: factory }).findContext(ctx, uuid()), es503);
  await assert.rejects(() => new PgNotificacionRepository({ pgPoolFactory: factory }).listByRequest(ctx, uuid(), 'X'), es503);
  await assert.rejects(() => new PgNotificacionRepository({ pgPoolFactory: factory }).listForUser(ctx, { limit: 1 }), es503);
});
