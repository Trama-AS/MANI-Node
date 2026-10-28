// HU-M05-07 (SCRUM-1403), decisión 6A: la asignación la registra Core, contra PostgreSQL real con el esquema oficial.
// Se omite sin TEST_DATABASE_URL; en CI corre siempre. Preparación local: PostgreSQL 15 vacío y
// scripts/preparar-base-pruebas.sh <MANI-APIGateway/database/migrations> (migraciones 001-008 y db/migrations).
//
// Core corre como `mani_core_svc` y Dispatch como `mani_dispatch_svc` (los dos NOBYPASSRLS); la siembra y los
// conteos usan el rol dueño.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgSolicitudAsignacionRepository = require('../../../src/infrastructure/repositories/PgSolicitudAsignacionRepository');
const PgNotificacionRepository = require('../../../src/infrastructure/repositories/PgNotificacionRepository');
const { runInTenantContext } = require('../../../src/infrastructure/db/runInTenantContext');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };

const uuid = () => crypto.randomUUID();
const comoRol = (u, rol) => `${u}${u.includes('?') ? '&' : '?'}options=-c%20role%3D${rol}`;

function entorno(t, { max = 10 } = {}) {
  const admin = new PgPoolFactory({ databaseUrl: url });
  const core = new PgPoolFactory({ databaseUrl: comoRol(url, 'mani_core_svc'), max });
  const dispatch = new PgPoolFactory({ databaseUrl: comoRol(url, 'mani_dispatch_svc') });
  t.after(() => Promise.all([admin.close(), core.close(), dispatch.close()]));
  return {
    pool: admin.getPool(),
    repo: new PgSolicitudAsignacionRepository({ pgPoolFactory: core }),
    notificaciones: new PgNotificacionRepository({ pgPoolFactory: core }),
    dispatch,
  };
}

async function sembrar(pool) {
  const s = { tenant: uuid(), padre: uuid(), zona: uuid(), categoria: uuid(), cliente: uuid(), sitio: uuid(), solicitud: uuid() };
  s.usuarioCliente = uuid();
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [s.tenant, `t-${s.tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, estado) VALUES ($1, 'CIUDAD', 'Bogotá', 'ACTIVO')", [s.padre]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, zona_padre_id, estado) VALUES ($1, 'LOCALIDAD', 'Chapinero', $2, 'ACTIVO')", [s.zona, s.padre]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Plomeria', 'ACTIVO')", [s.categoria, s.tenant]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVO')", [s.usuarioCliente, s.tenant, `${s.usuarioCliente}@t.test`]);
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [s.cliente, s.tenant, s.usuarioCliente]);
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1 # 2-3')", [s.sitio, s.tenant, s.cliente, s.zona]);
  await pool.query(
    "INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, estado) VALUES ($1, $2, $3, $4, $5, $6, 'PENDIENTE')",
    [s.solicitud, s.tenant, s.cliente, s.sitio, s.categoria, s.zona]
  );
  s.ctxCliente = { tenantId: s.tenant, userId: s.usuarioCliente, role: 'CLIENT' };
  return s;
}

async function aliado(pool, s, { verificacion = 'VERIFICADO', estadoUsuario = 'ACTIVO', zona = s.padre, oferta = true } = {}) {
  const usuario = uuid();
  const id = uuid();
  await pool.query('INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, $4, $5)', [usuario, s.tenant, `${usuario}@t.test`, 'ALIADO', estadoUsuario]);
  await pool.query(
    "INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'A', $4)",
    [id, s.tenant, usuario, verificacion]
  );
  await pool.query('INSERT INTO aliado_categoria (tenant_id, aliado_id, categoria_id) VALUES ($1, $2, $3)', [s.tenant, id, s.categoria]);
  await pool.query('INSERT INTO cobertura_aliado (tenant_id, aliado_id, zona_id) VALUES ($1, $2, $3)', [s.tenant, id, zona]);
  if (oferta) {
    await pool.query(
      "INSERT INTO notificacion (tenant_id, usuario_id, tipo, canal, payload) VALUES ($1, $2, 'OFERTA_DESPACHO', 'PUSH', $3)",
      [s.tenant, usuario, JSON.stringify({ requestId: s.solicitud })]
    );
  }
  return { id, usuario, ctx: { tenantId: s.tenant, userId: usuario, role: 'ALLY' } };
}

const contar = async (pool, sql, params) => (await pool.query(sql, params)).rows[0].n;
const eventos = (pool, s) => contar(pool, "SELECT count(*)::int AS n FROM evento_servicio WHERE solicitud_id = $1 AND tipo_evento = 'SOLICITUD_ASIGNADA'", [s.solicitud]);
const avisosCliente = (pool, s) =>
  contar(pool, "SELECT count(*)::int AS n FROM notificacion WHERE usuario_id = $1 AND tipo = 'SOLICITUD_ASIGNADA'", [s.usuarioCliente]);
const rechazaCon = (codigo) => (err) => err.code === codigo;

test('PG asignación como mani_core_svc: asigna, deja un evento y avisa al cliente; el reintento no repite nada', opts, async (t) => {
  const { pool, repo } = entorno(t);
  const s = await sembrar(pool);
  const ana = await aliado(pool, s);

  const primera = await repo.asignar(ana.ctx, s.solicitud);
  assert.equal(primera.asignada, true);
  assert.equal(primera.solicitud.estado, 'ASIGNADA');
  assert.equal(primera.solicitud.aliadoId, ana.id);
  const fila = (await pool.query('SELECT estado, aliado_id FROM solicitud WHERE id = $1', [s.solicitud])).rows[0];
  assert.deepEqual(fila, { estado: 'ASIGNADA', aliado_id: ana.id });
  assert.equal(await eventos(pool, s), 1);
  assert.equal(await avisosCliente(pool, s), 1);

  const reintento = await repo.asignar(ana.ctx, s.solicitud);
  assert.equal(reintento.asignada, false);
  assert.equal(reintento.solicitud.aliadoId, ana.id);
  assert.equal(await eventos(pool, s), 1, 'el reintento no duplica el evento');
  assert.equal(await avisosCliente(pool, s), 1, 'ni el aviso al cliente');
});

test('PG asignación: tomada por otro responde 409 sin revelar al ganador', opts, async (t) => {
  const { pool, repo } = entorno(t);
  const s = await sembrar(pool);
  const ana = await aliado(pool, s);
  const beto = await aliado(pool, s);
  await repo.asignar(ana.ctx, s.solicitud);

  await assert.rejects(() => repo.asignar(beto.ctx, s.solicitud), (err) => {
    assert.equal(err.code, 'MANI-SOL-409');
    assert.equal(err.statusCode, 409);
    assert.ok(!err.message.includes(ana.id), 'el mensaje no lleva el id del ganador');
    return true;
  });
});

test('PG asignación: estado, oferta, verificación, cuenta, elegibilidad y tenant', opts, async (t) => {
  const { pool, repo } = entorno(t);
  const s = await sembrar(pool);
  const ana = await aliado(pool, s);

  await pool.query("UPDATE solicitud SET estado = 'CANCELADA' WHERE id = $1", [s.solicitud]);
  await assert.rejects(() => repo.asignar(ana.ctx, s.solicitud), rechazaCon('MANI-SOL-409E'));
  await pool.query("UPDATE solicitud SET estado = 'PENDIENTE' WHERE id = $1", [s.solicitud]);

  const sinOferta = await aliado(pool, s, { oferta: false });
  await assert.rejects(() => repo.asignar(sinOferta.ctx, s.solicitud), rechazaCon('MANI-SOL-403O'));
  const pendiente = await aliado(pool, s, { verificacion: 'PENDIENTE' });
  await assert.rejects(() => repo.asignar(pendiente.ctx, s.solicitud), rechazaCon('MANI-SOL-403V'));
  const inactivo = await aliado(pool, s, { estadoUsuario: 'INACTIVO' });
  await assert.rejects(() => repo.asignar(inactivo.ctx, s.solicitud), rechazaCon('MANI-SOL-403'));
  const otraZona = uuid();
  await pool.query("INSERT INTO zona (id, nivel, nombre, estado) VALUES ($1, 'CIUDAD', 'Medellín', 'ACTIVO')", [otraZona]);
  const fueraDeZona = await aliado(pool, s, { zona: otraZona });
  await assert.rejects(() => repo.asignar(fueraDeZona.ctx, s.solicitud), rechazaCon('MANI-SOL-403E'));

  await assert.rejects(() => repo.asignar(ana.ctx, uuid()), rechazaCon('MANI-SOL-404'));
  const otro = await sembrar(pool);
  await assert.rejects(() => repo.asignar({ ...ana.ctx, tenantId: otro.tenant }, s.solicitud), rechazaCon('MANI-SOL-403'));

  assert.equal((await pool.query('SELECT aliado_id FROM solicitud WHERE id = $1', [s.solicitud])).rows[0].aliado_id, null);
  assert.equal(await eventos(pool, s), 0);
});

test('PG asignación (1403-C1/C2): 50 aliados aceptan a la vez y solo uno queda asignado', opts, async (t) => {
  const { pool, repo } = entorno(t, { max: 20 });
  const s = await sembrar(pool);
  const aliados = [];
  for (let i = 0; i < 50; i += 1) aliados.push(await aliado(pool, s));

  const resultados = await Promise.allSettled(aliados.map((a) => repo.asignar(a.ctx, s.solicitud)));

  const ganadores = resultados.filter((r) => r.status === 'fulfilled');
  const conflictos = resultados.filter((r) => r.status === 'rejected' && r.reason.code === 'MANI-SOL-409');
  assert.equal(ganadores.length, 1);
  assert.equal(conflictos.length, 49, 'los otros 49 reciben 409, ninguno otro error');
  const fila = (await pool.query('SELECT aliado_id FROM solicitud WHERE id = $1', [s.solicitud])).rows[0];
  assert.equal(fila.aliado_id, ganadores[0].value.solicitud.aliadoId);
  assert.equal(await eventos(pool, s), 1);
  assert.equal(await avisosCliente(pool, s), 1);
});

test('PG asignación: 10 reintentos simultáneos del mismo aliado dan una sola asignación', opts, async (t) => {
  const { pool, repo } = entorno(t);
  const s = await sembrar(pool);
  const ana = await aliado(pool, s);

  const resultados = await Promise.all(Array.from({ length: 10 }, () => repo.asignar(ana.ctx, s.solicitud)));

  assert.equal(resultados.filter((r) => r.asignada).length, 1);
  assert.ok(resultados.every((r) => r.solicitud.aliadoId === ana.id));
  assert.equal(await eventos(pool, s), 1);
});

test('PG bandeja del aliado: ofertas pendientes y asignadas propias, sin dirección ajena ni otro tenant', opts, async (t) => {
  const { pool, repo } = entorno(t);
  const s = await sembrar(pool);
  const ana = await aliado(pool, s);
  const beto = await aliado(pool, s);

  await pool.query("UPDATE solicitud SET descripcion = 'Gotea el lavaplatos' WHERE id = $1", [s.solicitud]);
  await pool.query("INSERT INTO solicitud_foto (tenant_id, solicitud_id, ruta_storage, orden) VALUES ($1, $2, 'f/1.jpg', 1)", [s.tenant, s.solicitud]);

  let bandeja = await repo.ofertasDelAliado(ana.ctx);
  assert.deepEqual(bandeja.map((x) => x.id), [s.solicitud]);
  assert.equal(bandeja[0].descripcion, 'Gotea el lavaplatos', 'el aliado ve el problema antes de aceptar');
  assert.equal(bandeja[0].fotos, 1);
  assert.equal(bandeja[0].esMia, false);
  assert.equal(bandeja[0].direccion, null, 'antes de asignarse no ve la dirección');
  assert.equal(bandeja[0].categoria, 'Plomeria');
  assert.equal(bandeja[0].zona, 'Chapinero');
  assert.equal(bandeja[0].zonaPadre, 'Bogotá');

  await repo.asignar(ana.ctx, s.solicitud);
  bandeja = await repo.ofertasDelAliado(ana.ctx);
  assert.equal(bandeja[0].esMia, true);
  assert.equal(bandeja[0].direccion, 'Calle 1 # 2-3');
  assert.ok(bandeja[0].asignadaEn instanceof Date);
  assert.deepEqual(await repo.ofertasDelAliado(beto.ctx), [], 'tomada por otro, desaparece de la bandeja');

  const otro = await sembrar(pool);
  await assert.rejects(() => repo.ofertasDelAliado({ ...ana.ctx, tenantId: otro.tenant }), rechazaCon('MANI-SOL-403'));
  const pendiente = await aliado(pool, s, { verificacion: 'PENDIENTE' });
  await assert.rejects(() => repo.ofertasDelAliado(pendiente.ctx), rechazaCon('MANI-SOL-403V'));
});

test('PG ofertas (1402, N-4): una sola oferta por aliado y solicitud aun con publicaciones simultáneas', opts, async (t) => {
  const { pool, notificaciones } = entorno(t);
  const s = await sembrar(pool);
  const ana = await aliado(pool, s, { oferta: false });
  const publicar = () =>
    notificaciones.createForAlly(s.ctxCliente, { allyId: ana.id, tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload: { requestId: s.solicitud } });

  const resultados = await Promise.all(Array.from({ length: 5 }, publicar));

  assert.equal(resultados.filter((r) => r.nueva).length, 1);
  assert.equal(new Set(resultados.map((r) => r.id)).size, 1, 'todas devuelven la misma oferta');
  assert.equal(
    await contar(pool, "SELECT count(*)::int AS n FROM notificacion WHERE usuario_id = $1 AND tipo = 'OFERTA_DESPACHO'", [ana.usuario]),
    1
  );
});

test('PG frontera 6A (0019): Dispatch no puede escribir solicitud y lee rechazos solo con el token del cliente o admin', opts, async (t) => {
  const { pool, dispatch } = entorno(t);
  const s = await sembrar(pool);
  const ana = await aliado(pool, s);
  await pool.query("INSERT INTO solicitud_rechazo (tenant_id, solicitud_id, aliado_id, motivo) VALUES ($1, $2, $3, 'FUERA_DE_ZONA')", [s.tenant, s.solicitud, ana.id]);

  await assert.rejects(
    () => runInTenantContext(dispatch, ana.ctx, (c) =>
      c.query("UPDATE solicitud SET estado = 'ASIGNADA', aliado_id = $2 WHERE id = $1", [s.solicitud, ana.id])),
    (err) => err.code === '42501'
  );

  const leer = (ctx) =>
    runInTenantContext(dispatch, ctx, async (c) =>
      (await c.query('SELECT aliado_id FROM solicitud_rechazo WHERE solicitud_id = $1', [s.solicitud])).rows.map((r) => r.aliado_id));
  assert.deepEqual(await leer(s.ctxCliente), [ana.id], 'el cliente que orquesta ve los rechazos');
  assert.deepEqual(await leer({ tenantId: s.tenant, userId: uuid(), role: 'ADMIN' }), [ana.id], 'el admin también');
  const otro = await sembrar(pool);
  assert.deepEqual(await leer(otro.ctxCliente), [], 'otro tenant no');
  const beto = await aliado(pool, s);
  assert.deepEqual(await leer(beto.ctx), [], 'otro aliado no ve rechazos ajenos');
  assert.deepEqual(await leer(ana.ctx), [ana.id], 'el aliado ve el suyo (política 0016)');
});
