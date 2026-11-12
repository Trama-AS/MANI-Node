// SCRUM-1656 (T-19) y SCRUM-1657 (T-20): evento_servicio inmutable y con actor, rol y correlation ID; pago con actor.
// Como `mani_core_svc` (sin BYPASSRLS). Se omite sin TEST_DATABASE_URL; en CI corre siempre.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { fabricasPg } = require('../../helpers/pgPruebas');
const { runInTenantContext } = require('../../../src/infrastructure/db/runInTenantContext');
const { ejecutarComo } = require('../../../src/application/context/contextoIdentidad');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };
const uuid = () => crypto.randomUUID();

async function sembrar(pool) {
  const s = { tenant: uuid(), usuario: uuid(), cliente: uuid(), solicitud: uuid(), cotizacion: uuid(), aliado: uuid() };
  const zona = uuid();
  const categoria = uuid();
  const sitio = uuid();
  const usuarioAliado = uuid();
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [s.tenant, `t-${s.tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, estado) VALUES ($1, 'CIUDAD', 'Z', 'ACTIVO')", [zona]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Plomeria', 'ACTIVO')", [categoria, s.tenant]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVO')", [s.usuario, s.tenant, `${s.usuario}@t.test`]);
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [s.cliente, s.tenant, s.usuario]);
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1')", [sitio, s.tenant, s.cliente, zona]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'ALIADO', 'ACTIVO')", [usuarioAliado, s.tenant, `${usuarioAliado}@t.test`]);
  await pool.query("INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'Ana', 'VERIFICADO')", [s.aliado, s.tenant, usuarioAliado]);
  await pool.query(
    "INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, aliado_id, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACEPTADA')",
    [s.solicitud, s.tenant, s.cliente, sitio, categoria, zona, s.aliado]
  );
  await pool.query(
    "INSERT INTO cotizacion (id, tenant_id, solicitud_id, aliado_id, valor_mano_obra, valor_materiales, estado) VALUES ($1, $2, $3, $4, 100, 0, 'ACEPTADA')",
    [s.cotizacion, s.tenant, s.solicitud, s.aliado]
  );
  return s;
}

const insertarEvento = (client, s, tipo = 'PRUEBA') =>
  client.query(
    "INSERT INTO evento_servicio (tenant_id, solicitud_id, actor_id, tipo_evento, descripcion) VALUES ($1, $2, $3, $4, 'x') RETURNING id, actor_id, actor_rol, correlation_id",
    [s.tenant, s.solicitud, s.usuario, tipo]
  );

test('PG 1657: un evento creado en una petición guarda el actor, su rol y el correlation ID', opts, async (t) => {
  const { pool, core } = fabricasPg(t, url);
  const s = await sembrar(pool);

  const fila = await ejecutarComo({ tenantId: s.tenant, userId: s.usuario, role: 'CLIENT', correlationId: 'corr-1657' }, () =>
    runInTenantContext(core, { tenantId: s.tenant, userId: s.usuario, role: 'CLIENT' }, async (c) => (await insertarEvento(c, s)).rows[0])
  );
  assert.equal(fila.actor_id, s.usuario);
  assert.equal(fila.actor_rol, 'cliente', 'rol en el vocabulario del claim');
  assert.equal(fila.correlation_id, 'corr-1657');
});

test('PG 1657: sin correlation ID queda NULL y el rol se guarda igual; el valor no se filtra a otra transacción', opts, async (t) => {
  const { pool, core } = fabricasPg(t, url);
  const s = await sembrar(pool);

  await runInTenantContext(core, { tenantId: s.tenant, userId: s.usuario, role: 'CLIENT', correlationId: 'corr-a' }, async (c) => insertarEvento(c, s));
  const despues = await runInTenantContext(core, { tenantId: s.tenant, userId: s.usuario, role: 'CLIENT' }, async (c) => (await insertarEvento(c, s)).rows[0]);

  assert.equal(despues.correlation_id, null, 'no hereda el de la transacción anterior, aunque reutilice la conexión');
  assert.equal(despues.actor_rol, 'cliente');
});

test('PG 1657: un pago guarda el usuario y el rol que lo realizó', opts, async (t) => {
  const { pool, core } = fabricasPg(t, url);
  const s = await sembrar(pool);

  const fila = await runInTenantContext(core, { tenantId: s.tenant, userId: s.usuario, role: 'CLIENT' }, async (c) =>
    (
      await c.query(
        `INSERT INTO pago (tenant_id, cotizacion_id, cliente_id, monto, moneda, estado, proveedor, simulado, referencia_proveedor)
         VALUES ($1, $2, $3, 100, 'COP', 'APROBADO', 'mock', true, $4) RETURNING actor_usuario_id, actor_rol`,
        [s.tenant, s.cotizacion, s.cliente, `mock-${uuid()}`]
      )
    ).rows[0]
  );
  assert.equal(fila.actor_usuario_id, s.usuario);
  assert.equal(fila.actor_rol, 'cliente');
});

test('PG 1656 C1: evento_servicio rechaza UPDATE, DELETE y TRUNCATE, incluso al dueño de la tabla', opts, async (t) => {
  const { pool, core } = fabricasPg(t, url);
  const s = await sembrar(pool);
  const { id } = await runInTenantContext(core, { tenantId: s.tenant, userId: s.usuario, role: 'CLIENT' }, async (c) => (await insertarEvento(c, s)).rows[0]);

  const inmutable = (err) => err.code === '42501' && /inmutable/.test(err.message);
  await assert.rejects(pool.query("UPDATE evento_servicio SET descripcion = 'cambio' WHERE id = $1", [id]), inmutable, 'UPDATE');
  await assert.rejects(pool.query('DELETE FROM evento_servicio WHERE id = $1', [id]), inmutable, 'DELETE');
  await assert.rejects(pool.query('TRUNCATE evento_servicio'), inmutable, 'TRUNCATE');
  assert.equal((await pool.query('SELECT descripcion FROM evento_servicio WHERE id = $1', [id])).rows[0].descripcion, 'x', 'la fila quedó intacta');
});

test('PG 1656 C2: la asignación queda en evento_servicio con quién la hizo, no solo en solicitud', opts, async (t) => {
  const { pool, core } = fabricasPg(t, url);
  const s = await sembrar(pool);
  const PgSolicitudAsignacionRepository = require('../../../src/infrastructure/repositories/PgSolicitudAsignacionRepository');
  const repo = new PgSolicitudAsignacionRepository({ pgPoolFactory: core });

  // La solicitud sembrada ya está asignada: se prepara una pendiente con oferta para el aliado.
  const pendiente = uuid();
  const { rows } = await pool.query('SELECT sitio_id, categoria_id, zona_id FROM solicitud WHERE id = $1', [s.solicitud]);
  await pool.query(
    "INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, estado) VALUES ($1, $2, $3, $4, $5, $6, 'PENDIENTE')",
    [pendiente, s.tenant, s.cliente, rows[0].sitio_id, rows[0].categoria_id, rows[0].zona_id]
  );
  const { rows: ali } = await pool.query('SELECT usuario_id FROM aliado WHERE id = $1', [s.aliado]);
  const usuarioAliado = ali[0].usuario_id;
  await pool.query("INSERT INTO aliado_categoria (tenant_id, aliado_id, categoria_id) VALUES ($1, $2, $3)", [s.tenant, s.aliado, rows[0].categoria_id]);
  await pool.query("INSERT INTO cobertura_aliado (tenant_id, aliado_id, zona_id) VALUES ($1, $2, $3)", [s.tenant, s.aliado, rows[0].zona_id]);
  await pool.query(
    "INSERT INTO notificacion (tenant_id, usuario_id, tipo, canal, payload) VALUES ($1, $2, 'OFERTA_DESPACHO', 'PUSH', $3::jsonb)",
    [s.tenant, usuarioAliado, JSON.stringify({ requestId: pendiente })]
  );

  const ctx = { tenantId: s.tenant, userId: usuarioAliado, role: 'ALLY' };
  await ejecutarComo({ ...ctx, correlationId: 'corr-asignacion' }, () => repo.asignar(ctx, pendiente));

  const evento = (await pool.query("SELECT actor_id, actor_rol, correlation_id FROM evento_servicio WHERE solicitud_id = $1 AND tipo_evento = 'SOLICITUD_ASIGNADA'", [pendiente])).rows[0];
  assert.equal(evento.actor_id, usuarioAliado);
  assert.equal(evento.actor_rol, 'aliado');
  assert.equal(evento.correlation_id, 'corr-asignacion');
});
