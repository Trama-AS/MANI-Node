// US-04.3.5 (SCRUM-872): adición por imprevisto contra PostgreSQL real con el esquema oficial y la migración 0023.
// Se omite sin TEST_DATABASE_URL; en CI corre siempre. Preparación local: PostgreSQL 15 vacío y
// scripts/preparar-base-pruebas.sh <MANI-APIGateway/database/migrations> (migraciones 001-008 y db/migrations).
//
// Core corre como `mani_core_svc` (NOBYPASSRLS): la prueba cubre también el GRANT y la política de la 0023. La siembra
// y los conteos usan el rol dueño.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgAdditionRepository = require('../../../src/infrastructure/repositories/PgAdditionRepository');
const PgPaymentRepository = require('../../../src/infrastructure/repositories/PgPaymentRepository');
const { DECISIONES } = require('../../../src/application/useCases/additions/RespondAdditionUseCase');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };

const uuid = () => crypto.randomUUID();
const comoRol = (u, rol) => `${u}${u.includes('?') ? '&' : '?'}options=-c%20role%3D${rol}`;
const MOTIVO = 'Tubería rota detrás del muro';

function entorno(t, { max = 10 } = {}) {
  const admin = new PgPoolFactory({ databaseUrl: url });
  const core = new PgPoolFactory({ databaseUrl: comoRol(url, 'mani_core_svc'), max });
  t.after(() => Promise.all([admin.close(), core.close()]));
  return {
    pool: admin.getPool(),
    repo: new PgAdditionRepository({ pgPoolFactory: core }),
    pagos: new PgPaymentRepository({ pgPoolFactory: core }),
  };
}

async function addUsuario(pool, tenant, rol) {
  const id = uuid();
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, $4, 'ACTIVO')", [id, tenant, `${id}@t.test`, rol]);
  return id;
}

async function addAliado(pool, tenant) {
  const usuario = await addUsuario(pool, tenant, 'ALIADO');
  const id = uuid();
  await pool.query(
    "INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'A', 'VERIFICADO')",
    [id, tenant, usuario]
  );
  return { id, ctx: { tenantId: tenant, userId: usuario, role: 'ALLY' } };
}

async function addCliente(pool, tenant) {
  const usuario = await addUsuario(pool, tenant, 'CLIENTE');
  const id = uuid();
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [id, tenant, usuario]);
  return { id, ctx: { tenantId: tenant, userId: usuario, role: 'CLIENT' } };
}

// Tenant con el cliente dueño, otro cliente, el aliado asignado, otro aliado y una solicitud EN_EJECUCION con la
// cotización v1 rechazada y la v2 ACEPTADA de 1000 (600 + 400).
async function seed(pool, { estado = 'EN_EJECUCION', conCotizacion = true } = {}) {
  const s = { tenant: uuid(), zona: uuid(), categoria: uuid(), sitio: uuid(), solicitud: uuid(), cotizacion: uuid() };
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [s.tenant, `t-${s.tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, zona_padre_id, estado) VALUES ($1, 'LOCALIDAD', 'Loc', NULL, 'ACTIVO')", [s.zona]);
  await pool.query("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Plomeria', 'ACTIVO')", [s.categoria, s.tenant]);
  s.cliente = await addCliente(pool, s.tenant);
  s.otroCliente = await addCliente(pool, s.tenant);
  s.aliado = await addAliado(pool, s.tenant);
  s.otroAliado = await addAliado(pool, s.tenant);
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1')", [s.sitio, s.tenant, s.cliente.id, s.zona]);
  await pool.query(
    'INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, aliado_id, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
    [s.solicitud, s.tenant, s.cliente.id, s.sitio, s.categoria, s.zona, s.aliado.id, estado]
  );
  if (conCotizacion) {
    await pool.query(
      "INSERT INTO cotizacion (tenant_id, solicitud_id, aliado_id, valor_mano_obra, valor_materiales, estado, version) VALUES ($1, $2, $3, 900, 900, 'RECHAZADA', 1)",
      [s.tenant, s.solicitud, s.aliado.id]
    );
    await pool.query(
      "INSERT INTO cotizacion (id, tenant_id, solicitud_id, aliado_id, valor_mano_obra, valor_materiales, estado, version) VALUES ($1, $2, $3, $4, 600, 400, 'ACEPTADA', 2)",
      [s.cotizacion, s.tenant, s.solicitud, s.aliado.id]
    );
  }
  return s;
}

const pedir = (repo, ctx, s, manoObra, materiales = 0) =>
  repo.solicitar(ctx, { solicitudId: s.solicitud, motivo: MOTIVO, valorManoObra: manoObra, valorMateriales: materiales, tiempoAdicionalMinutos: 60 });
const decidir = (repo, ctx, adicionId, accion, comentario = '') => repo.responder(ctx, { adicionId, decision: DECISIONES[accion], comentario });
const contar = async (pool, sql, params) => Number((await pool.query(sql, params)).rows[0].n);

test('PG adición: pedir → el cliente la ve → aceptar suma al total vigente y el pago cobra ese total', opts, async (t) => {
  const { pool, repo, pagos } = entorno(t);
  const s = await seed(pool);

  const pedida = await pedir(repo, s.aliado.ctx, s, 150, 50.5);
  assert.equal(pedida.adicion.estado, 'PENDIENTE');
  assert.equal(pedida.adicion.cotizacionId, s.cotizacion, 'se cuelga de la versión aceptada');
  assert.equal(pedida.adicion.total, 200.5);
  assert.equal(pedida.resumen.totalVigente, 1000, 'C2: pendiente no cambia el total');
  assert.ok(pedida.notificacionId);

  // C2: una sola pendiente a la vez.
  await assert.rejects(pedir(repo, s.aliado.ctx, s, 10), { code: 'MANI-ADI-409P' });

  const vista = await repo.listarPorSolicitud(s.cliente.ctx, s.solicitud);
  assert.deepEqual(vista.adiciones.map((a) => a.estado), ['PENDIENTE']);
  assert.equal((await repo.listarPorSolicitud(s.aliado.ctx, s.solicitud)).adiciones.length, 1, 'el aliado asignado también la ve');

  const aceptada = await decidir(repo, s.cliente.ctx, pedida.adicion.id, 'ACEPTAR');
  assert.equal(aceptada.adicion.estado, 'ACEPTADA');
  assert.ok(aceptada.adicion.respondidaEn);
  assert.deepEqual(aceptada.resumen, {
    cotizacionId: s.cotizacion, totalCotizacion: 1000, totalAdicionesAceptadas: 200.5, totalVigente: 1200.5, topeAdiciones: 500,
    disponibleParaAdiciones: 299.5,
  });
  await assert.rejects(decidir(repo, s.cliente.ctx, pedida.adicion.id, 'RECHAZAR'), { code: 'MANI-ADI-409R' });

  // Decisión de la PO: el pago (SCRUM-1432) cobra el total vigente, no solo la cotización.
  const cobro = await pagos.prepararCobro(s.cliente.ctx, { cotizacionId: s.cotizacion, claveIdempotencia: null });
  assert.equal(cobro.cobro.monto, 1200.5);

  const eventos = await pool.query(
    "SELECT tipo_evento FROM evento_servicio WHERE solicitud_id = $1 AND tipo_evento LIKE 'ADICION_%' ORDER BY timestamp, tipo_evento",
    [s.solicitud]
  );
  assert.deepEqual(eventos.rows.map((r) => r.tipo_evento).sort(), ['ADICION_ACEPTADA', 'ADICION_SOLICITADA']);
  const avisos = await pool.query('SELECT tipo, usuario_id FROM notificacion WHERE tenant_id = $1 ORDER BY tipo', [s.tenant]);
  assert.deepEqual(avisos.rows, [
    { tipo: 'ADICION_SOLICITADA', usuario_id: s.cliente.ctx.userId },
    { tipo: 'RESPUESTA_ADICION', usuario_id: s.aliado.ctx.userId },
  ]);
});

test('PG adición: rechazar no termina el servicio ni cambia el total; después se puede pedir otra', opts, async (t) => {
  const { pool, repo } = entorno(t);
  const s = await seed(pool);

  const pedida = await pedir(repo, s.aliado.ctx, s, 100);
  const rechazada = await decidir(repo, s.cliente.ctx, pedida.adicion.id, 'RECHAZAR', 'No estaba pactado');
  assert.equal(rechazada.adicion.estado, 'RECHAZADA');
  assert.equal(rechazada.adicion.comentarioCliente, 'No estaba pactado');
  assert.equal(rechazada.resumen.totalVigente, 1000);
  assert.equal((await pool.query('SELECT estado FROM solicitud WHERE id = $1', [s.solicitud])).rows[0].estado, 'EN_EJECUCION');

  const otra = await pedir(repo, s.aliado.ctx, s, 50);
  assert.equal(otra.adicion.estado, 'PENDIENTE');
});

test('PG adición: tope del 50 % de la cotización aceptada al pedir y al aceptar', opts, async (t) => {
  const { pool, repo } = entorno(t);
  const s = await seed(pool);

  await assert.rejects(pedir(repo, s.aliado.ctx, s, 500, 0.01), { code: 'MANI-ADI-400T' });
  const justa = await pedir(repo, s.aliado.ctx, s, 300, 200);
  await decidir(repo, s.cliente.ctx, justa.adicion.id, 'ACEPTAR');
  await assert.rejects(pedir(repo, s.aliado.ctx, s, 0.01), { code: 'MANI-ADI-400T' });

  // Si una aceptada entra por otro camino mientras otra está pendiente, aceptar la pendiente vuelve a medir el tope.
  const s2 = await seed(pool);
  const pendiente = await pedir(repo, s2.aliado.ctx, s2, 100);
  await pool.query(
    "INSERT INTO adicion_servicio (tenant_id, solicitud_id, cotizacion_id, aliado_id, motivo, valor_mano_obra, valor_materiales, estado, respondida_at) VALUES ($1, $2, $3, $4, $5, 450, 0, 'ACEPTADA', now())",
    [s2.tenant, s2.solicitud, s2.cotizacion, s2.aliado.id, MOTIVO]
  );
  await assert.rejects(decidir(repo, s2.cliente.ctx, pendiente.adicion.id, 'ACEPTAR'), { code: 'MANI-ADI-400T' });
  assert.equal((await pool.query('SELECT estado FROM adicion_servicio WHERE id = $1', [pendiente.adicion.id])).rows[0].estado, 'PENDIENTE');
});

test('PG adición: estado del servicio, cotización aceptada y aislamiento entre usuarios y tenants', opts, async (t) => {
  const { pool, repo } = entorno(t);

  const sinIniciar = await seed(pool, { estado: 'ACEPTADA' });
  await assert.rejects(pedir(repo, sinIniciar.aliado.ctx, sinIniciar, 10), { code: 'MANI-ADI-409E' });
  const sinCotizacion = await seed(pool, { conCotizacion: false });
  await assert.rejects(pedir(repo, sinCotizacion.aliado.ctx, sinCotizacion, 10), { code: 'MANI-ADI-409C' });

  const s = await seed(pool);
  const otro = await seed(pool);
  // C3: solo el aliado asignado pide; otro aliado del tenant recibe 403 y uno de otro tenant no la encuentra.
  await assert.rejects(pedir(repo, s.otroAliado.ctx, s, 10), { code: 'MANI-ADI-403A' });
  await assert.rejects(pedir(repo, { ...otro.aliado.ctx }, s, 10), { code: 'MANI-ADI-404' });

  const pedida = await pedir(repo, s.aliado.ctx, s, 10);
  // Otro cliente del mismo tenant o de otro tenant: ni la ve ni la decide.
  await assert.rejects(repo.listarPorSolicitud(s.otroCliente.ctx, s.solicitud), { code: 'MANI-ADI-404' });
  await assert.rejects(decidir(repo, s.otroCliente.ctx, pedida.adicion.id, 'ACEPTAR'), { code: 'MANI-ADI-404' });
  await assert.rejects(decidir(repo, otro.cliente.ctx, pedida.adicion.id, 'ACEPTAR'), { code: 'MANI-ADI-404' });
  // El aliado no decide sobre su propia adición: no es un cliente activo.
  await assert.rejects(decidir(repo, s.aliado.ctx, pedida.adicion.id, 'ACEPTAR'), { code: 'MANI-ADI-403C' });

  // Con el servicio cancelado ya no se decide; finalizado sí.
  await pool.query("UPDATE solicitud SET estado = 'CANCELADA' WHERE id = $1", [s.solicitud]);
  await assert.rejects(decidir(repo, s.cliente.ctx, pedida.adicion.id, 'ACEPTAR'), { code: 'MANI-ADI-409E' });
  await pool.query("UPDATE solicitud SET estado = 'FINALIZADA' WHERE id = $1", [s.solicitud]);
  assert.equal((await decidir(repo, s.cliente.ctx, pedida.adicion.id, 'ACEPTAR')).adicion.estado, 'ACEPTADA');
});

test('PG adición: varios pedidos simultáneos dejan una sola adición pendiente', opts, async (t) => {
  const { pool, repo } = entorno(t, { max: 10 });
  const s = await seed(pool);

  const resultados = await Promise.allSettled(Array.from({ length: 10 }, () => pedir(repo, s.aliado.ctx, s, 10)));

  assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(resultados.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'MANI-ADI-409P'));
  assert.equal(await contar(pool, "SELECT count(*) AS n FROM adicion_servicio WHERE solicitud_id = $1 AND estado = 'PENDIENTE'", [s.solicitud]), 1);
});

test('PG 0023: los CHECK rechazan filas que la API no aceptaría', opts, async (t) => {
  const { pool } = entorno(t);
  const s = await seed(pool);
  const insertar = (motivo, mano, mat) =>
    pool.query(
      'INSERT INTO adicion_servicio (tenant_id, solicitud_id, cotizacion_id, aliado_id, motivo, valor_mano_obra, valor_materiales) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [s.tenant, s.solicitud, s.cotizacion, s.aliado.id, motivo, mano, mat]
    );
  await assert.rejects(insertar('corto', 10, 0), /check/i);
  await assert.rejects(insertar(MOTIVO, -1, 5), /check/i);
  await assert.rejects(insertar(MOTIVO, 0, 0), /ck_adicion_servicio_total_positivo/);
  await assert.rejects(
    pool.query(
      "INSERT INTO adicion_servicio (tenant_id, solicitud_id, cotizacion_id, aliado_id, motivo, valor_mano_obra, valor_materiales, estado) VALUES ($1, $2, $3, $4, $5, 1, 0, 'ACEPTADA')",
      [s.tenant, s.solicitud, s.cotizacion, s.aliado.id, MOTIVO]
    ),
    /ck_adicion_servicio_respuesta/
  );
});
