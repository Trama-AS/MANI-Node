// Verifica el Módulo M-08 (SCRUM-1418, 874, 875, 876, 878, 879, 880) contra PostgreSQL real cuando TEST_DATABASE_URL está definida.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgRatingsRepository = require('../../../src/infrastructure/repositories/PgRatingsRepository');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };
const uuid = () => crypto.randomUUID();

test('PG Módulo M-08: sin DATABASE_URL PgRatingsRepository falla cerrado con 503 (T2)', async () => {
  const factory = new PgPoolFactory({ databaseUrl: undefined });
  const repo = new PgRatingsRepository({ pgPoolFactory: factory });
  const ctx = { tenantId: uuid(), userId: uuid(), role: 'CLIENT' };
  await assert.rejects(() => repo.registrarCalificacion(ctx, { solicitudId: uuid(), puntaje: 5 }), (e) => e.statusCode === 503);
  await assert.rejects(() => repo.listarHistorialCliente(ctx, {}), (e) => e.statusCode === 503);
  await assert.rejects(() => repo.listarHistorialAliado({ ...ctx, role: 'ALLY' }, {}), (e) => e.statusCode === 503);
});

test('PG Módulo M-08: flujo completo contra PostgreSQL real', opts, async (t) => {
  const factory = new PgPoolFactory({ databaseUrl: url });
  t.after(() => factory.close());
  const pool = factory.getPool();
  const repo = new PgRatingsRepository({ pgPoolFactory: factory });

  const tenant = uuid();
  const zona = uuid();
  const categoria = uuid();
  const usuarioCli = uuid();
  const usuarioAli = uuid();
  const cliente = uuid();
  const aliado = uuid();
  const sitio = uuid();
  const solicitud = uuid();

  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T-M08', $2, 'ACTIVO')", [tenant, `t-${tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, zona_padre_id, estado) VALUES ($1, 'LOCALIDAD', 'Suba', NULL, 'ACTIVO')", [zona]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Electricidad', 'ACTIVO')", [categoria, tenant]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'CLIENTE', 'ACTIVO')", [usuarioCli, tenant, `${usuarioCli}@t.test`]);
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, 'ALIADO', 'ACTIVO')", [usuarioAli, tenant, `${usuarioAli}@t.test`]);
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [cliente, tenant, usuarioCli]);
  await pool.query(
    "INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'Aliado M08', 'VERIFICADO')",
    [aliado, tenant, usuarioAli]
  );
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Cra 7 # 45')", [sitio, tenant, cliente, zona]);
  await pool.query(
    "INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, aliado_id, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, 'FINALIZADA')",
    [solicitud, tenant, cliente, sitio, categoria, zona, aliado]
  );

  const ctxCli = { tenantId: tenant, userId: usuarioCli, role: 'CLIENT' };
  const ctxAli = { tenantId: tenant, userId: usuarioAli, role: 'ALLY' };

  const r1 = await repo.registrarCalificacion(ctxCli, { solicitudId: solicitud, puntaje: 5, comentario: 'Excelente' });
  assert.equal(r1.cierre.cierreCompleto, false);

  const r2 = await repo.registrarCalificacion(ctxAli, { solicitudId: solicitud, puntaje: 5, comentario: 'Gran cliente' });
  assert.equal(r2.cierre.cierreCompleto, true);
  assert.equal(r2.cierre.estadoSolicitud, 'CERRADA');

  const histCli = await repo.listarHistorialCliente(ctxCli, {});
  assert.equal(histCli.length, 1);
  assert.equal(histCli[0].estado, 'CERRADA');

  const histAli = await repo.listarHistorialAliado(ctxAli, {});
  assert.equal(histAli.length, 1);
  assert.equal(histAli[0].estado, 'CERRADA');

  const detalleAli = await repo.obtenerTrabajoAliado(ctxAli, solicitud);
  assert.equal(detalleAli.id, solicitud);

  const califs = await repo.consultarCalificacionesYCierre(ctxCli, solicitud);
  assert.equal(califs.cierre.cierreCompleto, true);

  const repLista = await repo.listarReputacionAliados(ctxCli, {});
  assert.ok(repLista.length >= 1);

  const repAli = await repo.obtenerReputacionAliado(ctxCli, aliado);
  assert.equal(repAli.aliadoId, aliado);

  const ctxAdmin = { tenantId: tenant, userId: usuarioCli, role: 'ADMIN' };
  const polDef = await repo.obtenerPoliticaCancelacion(ctxAdmin);
  assert.equal(polDef.configurada, false);

  const polSet = await repo.configurarPoliticaCancelacion(ctxAdmin, {
    activa: true,
    ventanaGratuitaMinutos: 30,
    tipoCobro: 'MONTO_FIJO',
    valor: 45000,
    estadosGravables: ['ASIGNADA', 'COTIZANDO', 'ACEPTADA'],
  });
  assert.equal(polSet.configurada, true);
  assert.equal(polSet.valor, 45000);

  const polGet = await repo.obtenerPoliticaCancelacion(ctxAdmin);
  assert.equal(polGet.configurada, true);
  assert.equal(polGet.valor, 45000);

  const prev = await repo.previsualizarCancelacion(ctxCli, solicitud);
  assert.equal(prev.solicitudId, solicitud);

  const cierre = await repo.cerrarSolicitud(ctxCli, solicitud);
  assert.equal(cierre.cierreCompleto, true);
});
