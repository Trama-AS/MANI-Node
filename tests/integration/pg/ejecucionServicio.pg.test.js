// Verifica el inicio y el fin de la ejecución (SCRUM-868) contra PostgreSQL real con el esquema oficial.
// Se omite sin TEST_DATABASE_URL; en CI corre siempre. Preparación local: PostgreSQL 15 vacío y
// scripts/preparar-base-pruebas.sh <MANI-APIGateway/database/migrations> (migraciones 001-008 y db/migrations).
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const PgQuoteRepository = require('../../../src/infrastructure/repositories/PgQuoteRepository');
const PgServiceExecutionRepository = require('../../../src/infrastructure/repositories/PgServiceExecutionRepository');
const { DECISIONES } = require('../../../src/application/useCases/quotes/RespondQuoteUseCase');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };

const uuid = () => crypto.randomUUID();

async function addUsuario(pool, tenant, rol) {
  const id = uuid();
  await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, $4, 'ACTIVO')", [id, tenant, `${id}@t.test`, rol]);
  return id;
}

// Tenant con cliente, dos aliados y una solicitud ASIGNADA al primero, en una categoría del flujo indicado.
async function seed(pool, flujo = 'COTIZACION_PREVIA') {
  const s = { tenant: uuid(), zona: uuid(), categoria: uuid(), sitio: uuid(), solicitud: uuid(), cliente: uuid(), aliado: uuid(), aliado2: uuid() };
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [s.tenant, `t-${s.tenant}`]);
  await pool.query("INSERT INTO zona (id, nivel, nombre, zona_padre_id, estado) VALUES ($1, 'LOCALIDAD', 'Loc', NULL, 'ACTIVO')", [s.zona]);
  await pool.query(
    "INSERT INTO categoria_servicio (id, tenant_id, nombre, estado, flujo_operativo) VALUES ($1, $2, 'Plomeria', 'ACTIVO', $3)",
    [s.categoria, s.tenant, flujo]
  );
  s.usuarioCliente = await addUsuario(pool, s.tenant, 'CLIENTE');
  await pool.query("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [s.cliente, s.tenant, s.usuarioCliente]);
  for (const [aliado, clave] of [[s.aliado, 'usuarioAliado'], [s.aliado2, 'usuarioAliado2']]) {
    s[clave] = await addUsuario(pool, s.tenant, 'ALIADO');
    await pool.query(
      "INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'A', 'VERIFICADO')",
      [aliado, s.tenant, s[clave]]
    );
  }
  await pool.query("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1')", [s.sitio, s.tenant, s.cliente, s.zona]);
  await pool.query(
    "INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, aliado_id, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, 'ASIGNADA')",
    [s.solicitud, s.tenant, s.cliente, s.sitio, s.categoria, s.zona, s.aliado]
  );
  return s;
}

test('PG ejecución: cotización aceptada → inicio → fin, con horas del servidor, avisos y consulta', opts, async (t) => {
  const factory = new PgPoolFactory({ databaseUrl: url });
  t.after(() => factory.close());
  const pool = factory.getPool();
  const cotizaciones = new PgQuoteRepository({ pgPoolFactory: factory });
  const ejecucion = new PgServiceExecutionRepository({ pgPoolFactory: factory });
  const s = await seed(pool);
  const aliado = { tenantId: s.tenant, userId: s.usuarioAliado, role: 'ALLY' };
  const cliente = { tenantId: s.tenant, userId: s.usuarioCliente, role: 'CLIENT' };
  const marcar = (ctx, hito) => ejecucion.marcar(ctx, { solicitudId: s.solicitud, hito, observacion: '' });

  // C2: no se inicia sin la cotización aceptada ni se finaliza antes de iniciar.
  await assert.rejects(marcar(aliado, 'INICIO'), { code: 'MANI-EJE-409E' });
  await assert.rejects(marcar(aliado, 'FIN'), { code: 'MANI-EJE-409N' });

  const v1 = await cotizaciones.emitir(aliado, { solicitudId: s.solicitud, valorManoObra: 100000, valorMateriales: 0 });
  await cotizaciones.responder(cliente, { cotizacionId: v1.id, decision: DECISIONES.ACEPTAR, detalle: '' });

  // C3: otro aliado del tenant no marca.
  await assert.rejects(marcar({ ...aliado, userId: s.usuarioAliado2 }, 'INICIO'), { code: 'MANI-EJE-403A' });

  const inicio = await marcar(aliado, 'INICIO');
  assert.equal(inicio.solicitud.estado, 'EN_EJECUCION');
  assert.ok(inicio.evento.registradoEn instanceof Date);
  await assert.rejects(marcar(aliado, 'INICIO'), { code: 'MANI-EJE-409I' });

  const fin = await marcar(aliado, 'FIN');
  assert.equal(fin.solicitud.estado, 'FINALIZADA');
  assert.ok(fin.evento.registradoEn >= inicio.evento.registradoEn);
  await assert.rejects(marcar(aliado, 'FIN'), { code: 'MANI-EJE-409F' });

  // C1: el cliente ve las dos marcas con su hora.
  const vista = await ejecucion.consultar(cliente, s.solicitud);
  assert.equal(vista.estado, 'FINALIZADA');
  assert.equal(vista.inicio.registradoEn.getTime(), inicio.evento.registradoEn.getTime());
  assert.equal(vista.fin.registradoEn.getTime(), fin.evento.registradoEn.getTime());
  await assert.rejects(ejecucion.consultar({ ...aliado, userId: s.usuarioAliado2 }, s.solicitud), { code: 'MANI-EJE-404' });

  const avisos = await pool.query(
    "SELECT tipo FROM notificacion WHERE tenant_id = $1 AND usuario_id = $2 AND tipo LIKE 'EJECUCION_%' ORDER BY enviado_at, tipo",
    [s.tenant, s.usuarioCliente]
  );
  assert.deepEqual(avisos.rows.map((a) => a.tipo).sort(), ['EJECUCION_FINALIZADA', 'EJECUCION_INICIADA']);
});

test('PG ejecución: TARIFA_ESTANDAR inicia desde la asignación; otro tenant no la ve', opts, async (t) => {
  const factory = new PgPoolFactory({ databaseUrl: url });
  t.after(() => factory.close());
  const pool = factory.getPool();
  const ejecucion = new PgServiceExecutionRepository({ pgPoolFactory: factory });
  const s = await seed(pool, 'TARIFA_ESTANDAR');
  const otro = await seed(pool);

  await assert.rejects(
    ejecucion.marcar({ tenantId: otro.tenant, userId: otro.usuarioAliado, role: 'ALLY' }, { solicitudId: s.solicitud, hito: 'INICIO', observacion: '' }),
    { code: 'MANI-EJE-404' }
  );
  const r = await ejecucion.marcar(
    { tenantId: s.tenant, userId: s.usuarioAliado, role: 'ALLY' },
    { solicitudId: s.solicitud, hito: 'INICIO', observacion: 'Llegué' }
  );
  assert.equal(r.solicitud.estado, 'EN_EJECUCION');
  const evento = await pool.query("SELECT descripcion FROM evento_servicio WHERE solicitud_id = $1 AND tipo_evento = 'INICIO_EJECUCION'", [s.solicitud]);
  assert.equal(evento.rows[0].descripcion, 'Llegué');
});
