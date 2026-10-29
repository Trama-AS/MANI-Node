// Verifica la respuesta del cliente a la cotización (SCRUM-867) contra PostgreSQL real con el esquema oficial.
// Se omite sin TEST_DATABASE_URL; en CI corre siempre. Preparación local: PostgreSQL 15 vacío y
// scripts/preparar-base-pruebas.sh <MANI-APIGateway/database/migrations> (migraciones 001-008 y db/migrations).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgQuoteRepository = require('../../../src/infrastructure/repositories/PgQuoteRepository');
const { DECISIONES } = require('../../../src/application/useCases/quotes/RespondQuoteUseCase');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };

const uuid = () => crypto.randomUUID();

async function addUsuario(pool, tenant, rol) {
  const id = uuid();
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, $4, 'ACTIVO')", [id, tenant, `${id}@t.test`, rol]);
  return id;
}

// Tenant con el cliente dueño, otro cliente y el aliado asignado a una solicitud ASIGNADA.
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
    "INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, aliado_id, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ASIGNADA')",
    [s.solicitud, s.tenant, s.cliente, s.sitio, s.categoria, s.zona, s.aliado]
  );
  return s;
}

const decidir = (repo, ctx, cotizacionId, accion, detalle = '') =>
  repo.responder(ctx, { cotizacionId, decision: DECISIONES[accion], detalle });

test('PG respuesta: ajuste → nueva versión → aceptación, con evento y aviso al aliado', opts, async (t) => {
  const factory = new PgPoolFactory({ databaseUrl: url });
  t.after(() => factory.close());
  const pool = factory.getPool();
  const repo = new PgQuoteRepository({ pgPoolFactory: factory });
  const s = await seed(pool);
  const aliado = { tenantId: s.tenant, userId: s.usuarioAliado, role: 'ALLY' };
  const cliente = { tenantId: s.tenant, userId: s.usuarioCliente, role: 'CLIENT' };

  const v1 = await repo.emitir(aliado, { solicitudId: s.solicitud, valorManoObra: 100000, valorMateriales: 50000 });

  // C3: otro cliente del tenant no la ve; C1: el dueño pide ajuste y la solicitud sigue en COTIZANDO.
  await assert.rejects(decidir(repo, { ...cliente, userId: s.usuarioCliente2 }, v1.id, 'ACEPTAR'), { code: 'MANI-COT-404' });
  const ajuste = await decidir(repo, cliente, v1.id, 'AJUSTAR', 'Bajar materiales');
  assert.equal(ajuste.cotizacion.estado, 'AJUSTE_SOLICITADO');
  assert.equal(ajuste.solicitud.estado, 'COTIZANDO');

  // C2: responder dos veces la misma versión no produce una segunda transición.
  await assert.rejects(decidir(repo, cliente, v1.id, 'ACEPTAR'), { code: 'MANI-COT-409R' });

  const v2 = await repo.emitir(aliado, { solicitudId: s.solicitud, valorManoObra: 100000, valorMateriales: 30000 });
  assert.equal(v2.version, 2);
  const acepto = await decidir(repo, cliente, v2.id, 'ACEPTAR');
  assert.equal(acepto.cotizacion.estado, 'ACEPTADA');

  const fila = await pool.query('SELECT estado FROM solicitud WHERE id = $1', [s.solicitud]);
  assert.equal(fila.rows[0].estado, 'ACEPTADA');
  const eventos = await pool.query(
    "SELECT tipo_evento FROM evento_servicio WHERE solicitud_id = $1 AND tipo_evento <> 'COTIZACION_ENVIADA' ORDER BY timestamp, tipo_evento",
    [s.solicitud]
  );
  assert.deepEqual(eventos.rows.map((e) => e.tipo_evento).sort(), ['AJUSTE_SOLICITADO', 'COTIZACION_ACEPTADA']);
  const avisos = await pool.query(
    "SELECT usuario_id, payload FROM notificacion WHERE tenant_id = $1 AND tipo = 'RESPUESTA_COTIZACION'",
    [s.tenant]
  );
  assert.equal(avisos.rows.length, 2);
  assert.ok(avisos.rows.every((a) => a.usuario_id === s.usuarioAliado));
  assert.deepEqual(avisos.rows.map((a) => a.payload.decision).sort(), ['ACEPTAR', 'AJUSTAR']);

  // Con la solicitud ACEPTADA ya no se puede emitir otra cotización (SCRUM-865).
  await assert.rejects(repo.emitir(aliado, { solicitudId: s.solicitud, valorManoObra: 1, valorMateriales: 0 }), { code: 'MANI-COT-409E' });
});

test('PG respuesta: el rechazo cierra la solicitud y otro tenant no puede responder', opts, async (t) => {
  const factory = new PgPoolFactory({ databaseUrl: url });
  t.after(() => factory.close());
  const pool = factory.getPool();
  const repo = new PgQuoteRepository({ pgPoolFactory: factory });
  const s = await seed(pool);
  const otro = await seed(pool);
  const v1 = await repo.emitir(
    { tenantId: s.tenant, userId: s.usuarioAliado, role: 'ALLY' },
    { solicitudId: s.solicitud, valorManoObra: 100000, valorMateriales: 0 }
  );

  await assert.rejects(decidir(repo, { tenantId: otro.tenant, userId: otro.usuarioCliente, role: 'CLIENT' }, v1.id, 'RECHAZAR', 'Muy costosa'), {
    code: 'MANI-COT-404',
  });
  const r = await decidir(repo, { tenantId: s.tenant, userId: s.usuarioCliente, role: 'CLIENT' }, v1.id, 'RECHAZAR', 'Muy costosa');
  assert.equal(r.solicitud.estado, 'RECHAZADA');
  const evento = await pool.query("SELECT descripcion FROM evento_servicio WHERE solicitud_id = $1 AND tipo_evento = 'COTIZACION_RECHAZADA'", [s.solicitud]);
  assert.equal(evento.rows[0].descripcion, 'Cotización v1: Muy costosa');
});
