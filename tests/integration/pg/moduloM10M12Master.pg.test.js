// Prueba maestra de los módulos M-10 (SCRUM-885, 886, 887) y M-12 (SCRUM-895, 896, 900, 901): cada criterio C1-C3 se
// verifica por HTTP contra la app real (JWT -> authenticate -> caso de uso -> repositorio pg) y PostgreSQL real, conectado
// como `mani_core_svc` (sin BYPASSRLS) para que RLS y los disparadores de las migraciones 0029-0031 sí se evalúen.
// Rules es un doble HTTP que habla el contrato de POST /api/v1/rules/rates/evaluate. Se omite sin TEST_DATABASE_URL.
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');
const PgPoolFactory = require('../../../src/infrastructure/db/PgPoolFactory');
const RulesServiceHttpClient = require('../../../src/infrastructure/clients/RulesServiceHttpClient');
const PgTariffRepository = require('../../../src/infrastructure/repositories/PgTariffRepository');
const PgComplaintRepository = require('../../../src/infrastructure/repositories/PgComplaintRepository');
const PgOperationalMetricsRepository = require('../../../src/infrastructure/repositories/PgOperationalMetricsRepository');
const PgTenantStatusRepository = require('../../../src/infrastructure/repositories/PgTenantStatusRepository');
const TariffsUseCase = require('../../../src/application/useCases/tariffs/TariffsUseCase');
const ComplaintsUseCase = require('../../../src/application/useCases/complaints/ComplaintsUseCase');
const OperationalMetricsUseCase = require('../../../src/application/useCases/metrics/OperationalMetricsUseCase');
const TenantStatusUseCase = require('../../../src/application/useCases/tenants/TenantStatusUseCase');
const { withTenantContext } = require('../../../src/infrastructure/db/withTenantContext');
const { startFakeRulesService } = require('../../helpers/fakeRulesService');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };
const uuid = () => crypto.randomUUID();
const comoCore = (u) => `${u}${u.includes('?') ? '&' : '?'}options=-c%20role%3Dmani_core_svc`;

// Mismo criterio que RateEvaluator de MANI-Java (tolerancia 0): el doble no decide nada que Rules no decida igual.
function rulesDeTarifas({ body, headers }) {
  if (!headers['x-tenant-id'] || !headers['x-user-role']) return { status: 400, body: { code: 'TENANT_REQUIRED' } };
  return {
    status: 200,
    body: {
      version: 'rates-v1',
      resultados: body.items.map((i) => {
        if (i.total < i.valorMin) return { id: i.id, resultado: 'POR_DEBAJO', desviacionPorcentaje: Math.round(((i.valorMin - i.total) * 10000) / i.valorMin) / 100 };
        if (i.total > i.valorMax) return { id: i.id, resultado: 'POR_ENCIMA', desviacionPorcentaje: Math.round(((i.total - i.valorMax) * 10000) / i.valorMax) / 100 };
        return { id: i.id, resultado: 'DENTRO_DE_RANGO', desviacionPorcentaje: 0 };
      }),
    },
  };
}

const token = ({ sub, tenant, role }) =>
  `Bearer ${jwt.sign({ sub, app_metadata: { tenant_id: tenant, user_role: role } }, config.supabaseJwtSecret, { algorithm: 'HS256', expiresIn: '1h' })}`;

async function sembrarTenant(pool) {
  const t = {
    id: uuid(), zona: uuid(), categoria: uuid(), categoriaSinTarifa: uuid(),
    cliente: { usuario: uuid(), id: uuid(), sitio: uuid() },
    otroCliente: { usuario: uuid(), id: uuid(), sitio: uuid() },
    aliado: { usuario: uuid(), id: uuid() },
    admin: { usuario: uuid() },
    plataforma: { usuario: uuid() },
    solicitud: uuid(), solicitudSinTarifa: uuid(), solicitudSinAliado: uuid(), solicitudOtroCliente: uuid(),
  };
  const q = (sql, params) => pool.query(sql, params);
  await q("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'Tenant', $2, 'ACTIVO')", [t.id, `t-${t.id}`]);
  await q("INSERT INTO zona (id, nivel, nombre, estado) VALUES ($1, 'CIUDAD', 'Z', 'ACTIVO')", [t.zona]);
  await q("INSERT INTO categoria_servicio (id, tenant_id, nombre, estado) VALUES ($1, $2, 'Plomeria', 'ACTIVO'), ($3, $2, 'Pintura', 'ACTIVO')", [t.categoria, t.id, t.categoriaSinTarifa]);
  const usuario = (id, rol) => q("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, $4, 'ACTIVO')", [id, t.id, `${id}@t.test`, rol]);
  await usuario(t.cliente.usuario, 'CLIENTE');
  await usuario(t.otroCliente.usuario, 'CLIENTE');
  await usuario(t.aliado.usuario, 'ALIADO');
  await usuario(t.admin.usuario, 'ADMIN_TENANT');
  await usuario(t.plataforma.usuario, 'ADMIN_PLATAFORMA');
  for (const c of [t.cliente, t.otroCliente]) {
    await q("INSERT INTO cliente (id, tenant_id, usuario_id, tipo) VALUES ($1, $2, $3, 'PERSONA_NATURAL')", [c.id, t.id, c.usuario]);
    await q("INSERT INTO sitio (id, tenant_id, cliente_id, zona_id, direccion) VALUES ($1, $2, $3, $4, 'Calle 1')", [c.sitio, t.id, c.id, t.zona]);
  }
  await q("INSERT INTO aliado (id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion) VALUES ($1, $2, $3, 'PERSONA_NATURAL', 'Ana Aliada', 'VERIFICADO')", [t.aliado.id, t.id, t.aliado.usuario]);
  const solicitud = (id, cliente, categoria, aliado, estado) =>
    q('INSERT INTO solicitud (id, tenant_id, cliente_id, sitio_id, categoria_id, zona_id, aliado_id, estado) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [id, t.id, cliente.id, cliente.sitio, categoria, t.zona, aliado, estado]);
  await solicitud(t.solicitud, t.cliente, t.categoria, t.aliado.id, 'COTIZANDO');
  await solicitud(t.solicitudSinTarifa, t.cliente, t.categoriaSinTarifa, t.aliado.id, 'FINALIZADA');
  await solicitud(t.solicitudSinAliado, t.cliente, t.categoria, null, 'PENDIENTE');
  await solicitud(t.solicitudOtroCliente, t.otroCliente, t.categoria, t.aliado.id, 'CANCELADA');
  return {
    ...t,
    jwt: {
      cliente: token({ sub: t.cliente.usuario, tenant: t.id, role: 'cliente' }),
      otroCliente: token({ sub: t.otroCliente.usuario, tenant: t.id, role: 'cliente' }),
      aliado: token({ sub: t.aliado.usuario, tenant: t.id, role: 'aliado' }),
      admin: token({ sub: t.admin.usuario, tenant: t.id, role: 'admin_tenant' }),
      plataforma: token({ sub: t.plataforma.usuario, tenant: t.id, role: 'admin_plataforma' }),
    },
  };
}

async function cotizar(pool, t, { solicitud = t.solicitud, total, creadaEn = new Date().toISOString(), estado = 'PENDIENTE', version = 1 }) {
  const id = uuid();
  await pool.query(
    `INSERT INTO cotizacion (id, tenant_id, solicitud_id, aliado_id, valor_mano_obra, valor_materiales, estado, version, created_at)
     VALUES ($1, $2, $3, $4, $5, 0, $6, $7, $8)`,
    [id, t.id, solicitud, t.aliado.id, total, estado, version, creadaEn]
  );
  return id;
}

/** Monta los casos de uso de M-10/M-12 con repositorios pg (como mani_core_svc) y Rules de prueba; restaura al terminar. */
async function entorno(t) {
  const admin = new PgPoolFactory({ databaseUrl: url });
  const core = new PgPoolFactory({ databaseUrl: comoCore(url) });
  const rules = await startFakeRulesService();
  rules.respondWith(rulesDeTarifas);
  const ruleEvaluationService = new RulesServiceHttpClient({ baseUrl: rules.url, retries: 0 });
  const originales = {};
  const nuevos = {
    tariffsUseCase: new TariffsUseCase({ tariffRepository: new PgTariffRepository({ pgPoolFactory: core }), ruleEvaluationService }),
    complaintsUseCase: new ComplaintsUseCase({ complaintRepository: new PgComplaintRepository({ pgPoolFactory: core }) }),
    operationalMetricsUseCase: new OperationalMetricsUseCase({ metricsRepository: new PgOperationalMetricsRepository({ pgPoolFactory: core }) }),
    tenantStatusUseCase: new TenantStatusUseCase({ tenantStatusRepository: new PgTenantStatusRepository({ pgPoolFactory: core }) }),
  };
  for (const [k, v] of Object.entries(nuevos)) {
    originales[k] = container[k];
    container[k] = v;
  }
  t.after(async () => {
    Object.assign(container, originales);
    await Promise.all([admin.close(), core.close(), rules.close()]);
  });
  return { pool: admin.getPool(), corePool: core.getPool(), rules };
}

const api = (metodo, ruta, jwtSesion, correlation = `corr-${crypto.randomUUID().slice(0, 8)}`) =>
  request(app)[metodo](`/api/v1${ruta}`).set('Authorization', jwtSesion).set('X-Correlation-ID', correlation);

const hoy = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
const tarifaBase = (categoriaId, extra = {}) => ({ categoriaId, valorMin: 100000, valorTipico: 150000, valorMax: 200000, vigenciaDesde: '2026-01-01', condiciones: 'Incluye visita técnica', ...extra });

// =============================================================== SCRUM-885 · HU-M10-01
test('885 C1: el administrador carga la tarifa, la consulta y queda persistida con actor del JWT y correlación', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);

  const creada = await api('post', '/tarifas', a.jwt.admin, 'corr-885-c1').send(tarifaBase(a.categoria));
  assert.equal(creada.status, 201, JSON.stringify(creada.body));
  assert.equal(creada.body.tarifa.version, 1);
  assert.equal(creada.body.tarifa.estado, 'ACTIVA');
  assert.equal(creada.body.tarifa.categoriaNombre, 'Plomeria');
  assert.deepEqual([creada.body.tarifa.valorMin, creada.body.tarifa.valorTipico, creada.body.tarifa.valorMax], [100000, 150000, 200000]);

  const lista = await api('get', '/tarifas', a.jwt.admin);
  assert.equal(lista.status, 200);
  assert.deepEqual(lista.body.tarifas.map((x) => x.id), [creada.body.tarifa.id]);

  const fila = (await pool.query('SELECT * FROM tarifa_referencia WHERE id = $1', [creada.body.tarifa.id])).rows[0];
  assert.equal(fila.tenant_id, a.id);
  assert.equal(fila.creado_por, a.admin.usuario, 'el actor sale del JWT');
  assert.equal(fila.actor_rol, 'ADMIN');
  assert.equal(fila.correlation_id, 'corr-885-c1');
  assert.equal(fila.moneda, 'COP');
  assert.equal(fila.condiciones, 'Incluye visita técnica');
});

test('885 C1: editar crea una versión nueva y conserva la anterior REEMPLAZADA en el historial', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const v1 = (await api('post', '/tarifas', a.jwt.admin).send(tarifaBase(a.categoria))).body.tarifa;

  const v2 = await api('put', `/tarifas/${v1.id}`, a.jwt.admin).send(tarifaBase(a.categoria, { valorMax: 250000, condiciones: 'Nueva condición' }));
  assert.equal(v2.status, 200, JSON.stringify(v2.body));
  assert.equal(v2.body.tarifa.version, 2);
  assert.equal(v2.body.tarifa.reemplazaId, v1.id);
  assert.equal(v2.body.tarifa.valorMax, 250000);

  const historial = await api('get', `/tarifas/categorias/${a.categoria}/historial`, a.jwt.admin);
  assert.deepEqual(historial.body.versiones.map((x) => [x.version, x.estado, x.valorMax]), [[2, 'ACTIVA', 250000], [1, 'REEMPLAZADA', 200000]]);
  assert.deepEqual((await api('get', '/tarifas', a.jwt.admin)).body.tarifas.map((x) => x.version), [2]);
});

test('885 C2: valores negativos o invertidos, vigencia cruzada y categoría inválida se rechazan sin tocar la tarifa vigente', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  const vigente = (await api('post', '/tarifas', a.jwt.admin).send(tarifaBase(a.categoria))).body.tarifa;
  const filas = async () => (await pool.query('SELECT id, estado, valor_min, valor_max FROM tarifa_referencia WHERE tenant_id = $1 ORDER BY version', [a.id])).rows;
  const antes = await filas();

  for (const body of [tarifaBase(a.categoria, { valorMin: -5 }), tarifaBase(a.categoria, { valorMin: 300000 }), tarifaBase(a.categoria, { vigenciaHasta: '2025-12-31' })]) {
    const r = await api('post', '/tarifas', a.jwt.admin).send(body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal(r.body.code, 'MANI-TAR-400');
    assert.ok(r.body.correlationId);
  }
  // Una tarifa nueva que se cruza con la vigente se rechaza: editar es la vía para cambiarla.
  const cruzada = await api('post', '/tarifas', a.jwt.admin).send(tarifaBase(a.categoria, { vigenciaDesde: '2026-06-01' }));
  assert.equal(cruzada.status, 409);
  assert.equal(cruzada.body.code, 'MANI-TAR-409V');
  // Categoría de otro tenant o inexistente.
  for (const categoriaId of [b.categoria, uuid()]) {
    const r = await api('post', '/tarifas', a.jwt.admin).send(tarifaBase(categoriaId));
    assert.equal(r.status, 404);
    assert.equal(r.body.code, 'MANI-TAR-404C');
  }
  // Una edición inválida tampoco reemplaza la vigente.
  const editMala = await api('put', `/tarifas/${vigente.id}`, a.jwt.admin).send(tarifaBase(a.categoria, { valorTipico: 999999 }));
  assert.equal(editMala.status, 400);
  assert.deepEqual(await filas(), antes);

  // Editar una versión ya reemplazada es 409.
  await api('put', `/tarifas/${vigente.id}`, a.jwt.admin).send(tarifaBase(a.categoria, { valorMax: 210000 }));
  const otraVez = await api('put', `/tarifas/${vigente.id}`, a.jwt.admin).send(tarifaBase(a.categoria, { valorMax: 220000 }));
  assert.equal(otraVez.status, 409);
  assert.equal(otraVez.body.code, 'MANI-TAR-409R');

  // Una tarifa con vigencia que no se cruza sí convive (tarifa futura).
  const futura = await api('post', '/tarifas', b.jwt.admin).send(tarifaBase(b.categoria, { vigenciaDesde: '2026-01-01', vigenciaHasta: '2026-06-30' }));
  const siguiente = await api('post', '/tarifas', b.jwt.admin).send(tarifaBase(b.categoria, { vigenciaDesde: '2026-07-01' }));
  assert.deepEqual([futura.status, siguiente.status], [201, 201]);
  assert.equal(siguiente.body.tarifa.version, 2);
});

test('885 C3: el tenant B no ve ni edita las tarifas de A; cliente y aliado reciben 403; sin token 401', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  const tarifaA = (await api('post', '/tarifas', a.jwt.admin).send(tarifaBase(a.categoria))).body.tarifa;

  assert.deepEqual((await api('get', '/tarifas', b.jwt.admin)).body.tarifas, []);
  const editar = await api('put', `/tarifas/${tarifaA.id}`, b.jwt.admin).send(tarifaBase(a.categoria, { valorMax: 900000 }));
  assert.equal(editar.status, 404);
  assert.equal(editar.body.code, 'MANI-TAR-404');
  assert.equal((await api('get', `/tarifas/categorias/${a.categoria}/historial`, b.jwt.admin)).status, 404);
  for (const jwtSesion of [a.jwt.cliente, a.jwt.aliado]) {
    assert.equal((await api('get', '/tarifas', jwtSesion)).status, 403);
    assert.equal((await api('post', '/tarifas', jwtSesion).send(tarifaBase(a.categoria))).status, 403);
  }
  assert.equal((await request(app).get('/api/v1/tarifas')).status, 401);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM tarifa_referencia WHERE tenant_id = $1', [a.id])).rows[0].n, 1);
});

test('885 T10: una versión es inmutable aun para el rol de servicio y no se borra', opts, async (t) => {
  const { pool, corePool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const v1 = (await api('post', '/tarifas', a.jwt.admin).send(tarifaBase(a.categoria))).body.tarifa;
  const ctx = { tenantId: a.id, userId: a.admin.usuario, role: 'admin_tenant' };

  await assert.rejects(() => withTenantContext(corePool, ctx, (c) => c.query('UPDATE tarifa_referencia SET valor_max = 1 WHERE id = $1', [v1.id])), /MANI-TAR-409I/);
  await assert.rejects(() => withTenantContext(corePool, ctx, (c) => c.query('DELETE FROM tarifa_referencia WHERE id = $1', [v1.id])), /permission denied|MANI-TAR-409I/);
  await assert.rejects(() => pool.query('UPDATE tarifa_referencia SET valor_min = 0 WHERE id = $1', [v1.id]), /MANI-TAR-409I/);
});

// =============================================================== SCRUM-886 · HU-M10-02
test('886 C1: el aliado asignado y el cliente dueño ven la tarifa vigente de la categoría, sin datos de auditoría', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);
  await api('post', '/tarifas', a.jwt.admin).send(tarifaBase(a.categoria));

  for (const jwtSesion of [a.jwt.aliado, a.jwt.cliente, a.jwt.admin]) {
    const r = await api('get', `/solicitudes/${a.solicitud}/tarifa-referencia`, jwtSesion);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.disponible, true);
    assert.deepEqual([r.body.tarifa.valorMin, r.body.tarifa.valorTipico, r.body.tarifa.valorMax, r.body.tarifa.moneda], [100000, 150000, 200000, 'COP']);
    assert.equal(r.body.tarifa.categoriaNombre, 'Plomeria');
    assert.equal(r.body.tarifa.auditoria, undefined, 'el cliente y el aliado no ven quién cargó la tarifa');
  }
});

test('886 C2: sin tarifa vigente (categoría sin tarifa, vencida o futura) se indica no disponible, nunca un valor', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);

  const sinTarifa = await api('get', `/solicitudes/${a.solicitudSinTarifa}/tarifa-referencia`, a.jwt.aliado);
  assert.equal(sinTarifa.status, 200);
  assert.deepEqual({ disponible: sinTarifa.body.disponible, tarifa: sinTarifa.body.tarifa }, { disponible: false, tarifa: null });

  await api('post', '/tarifas', a.jwt.admin).send(tarifaBase(a.categoria, { vigenciaDesde: '2025-01-01', vigenciaHasta: '2025-12-31' }));
  await api('post', '/tarifas', a.jwt.admin).send(tarifaBase(a.categoria, { vigenciaDesde: '2099-01-01' }));
  const fueraDeVigencia = await api('get', `/solicitudes/${a.solicitud}/tarifa-referencia`, a.jwt.cliente);
  assert.equal(fueraDeVigencia.body.disponible, false);
  assert.equal(fueraDeVigencia.body.tarifa, null);
});

test('886 C3: otro cliente, el aliado de otro tenant o una solicitud ajena no exponen la tarifa (404)', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  await api('post', '/tarifas', a.jwt.admin).send(tarifaBase(a.categoria));

  for (const jwtSesion of [a.jwt.otroCliente, b.jwt.aliado, b.jwt.cliente, b.jwt.admin]) {
    const r = await api('get', `/solicitudes/${a.solicitud}/tarifa-referencia`, jwtSesion);
    assert.equal(r.status, 404, JSON.stringify(r.body));
    assert.equal(r.body.code, 'MANI-TAR-404S');
    assert.equal(r.body.tarifa, undefined);
  }
});

// =============================================================== SCRUM-887 · HU-M10-03
test('887 C1: el reporte lista las cotizaciones del periodo que Rules evaluó fuera de rango, con la tarifa que regía', opts, async (t) => {
  const { pool, rules } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  const v1 = (await api('post', '/tarifas', a.jwt.admin).send(tarifaBase(a.categoria))).body.tarifa;

  const debajo = await cotizar(pool, a, { total: 80000 });
  await cotizar(pool, a, { total: 150000, version: 2 });
  const encima = await cotizar(pool, a, { total: 300000, version: 3 });
  await cotizar(pool, a, { solicitud: a.solicitudSinTarifa, total: 999999 });
  // Otro tenant con una cotización fuera de rango: no debe aparecer.
  await api('post', '/tarifas', b.jwt.admin).send(tarifaBase(b.categoria));
  await cotizar(pool, b, { total: 1 });

  const r = await api('get', `/reportes/cotizaciones-fuera-de-rango?desde=${hoy()}&hasta=${hoy()}`, a.jwt.admin, 'corr-887');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.totales, { cotizaciones: 4, evaluadas: 3, sinTarifa: 1, fueraDeRango: 2 });
  assert.deepEqual(new Set(r.body.cotizaciones.map((c) => c.id)), new Set([debajo, encima]));
  const porId = Object.fromEntries(r.body.cotizaciones.map((c) => [c.id, c]));
  assert.equal(porId[debajo].resultado, 'POR_DEBAJO');
  assert.equal(porId[debajo].desviacionPorcentaje, 20);
  assert.equal(porId[encima].resultado, 'POR_ENCIMA');
  assert.equal(porId[encima].tarifa.id, v1.id);
  assert.equal(porId[encima].aliado.nombre, 'Ana Aliada');
  assert.equal(r.body.reglasVersion, 'rates-v1');

  // Rules recibió los hechos con el tenant y la correlación de la sesión; nada de otro tenant.
  const enviados = rules.requests.filter((x) => x.url === '/api/v1/rules/rates/evaluate');
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].headers['x-tenant-id'], a.id);
  assert.equal(enviados[0].headers['x-correlation-id'], 'corr-887');
  assert.equal(enviados[0].body.items.length, 3);
});

test('887 C1: una cotización emitida antes de editar la tarifa se evalúa contra la versión que regía entonces', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const v1 = (await api('post', '/tarifas', a.jwt.admin).send(tarifaBase(a.categoria))).body.tarifa;
  // Cotización 210.000 emitida con v1 (máx 200.000) ...
  const vieja = await cotizar(pool, a, { total: 210000 });
  await new Promise((r) => setTimeout(r, 20));
  // ... y después la tarifa sube el máximo a 300.000 (v2). La cotización sigue fuera del rango de v1.
  await api('put', `/tarifas/${v1.id}`, a.jwt.admin).send(tarifaBase(a.categoria, { valorMax: 300000 }));
  const nueva = await cotizar(pool, a, { total: 210000, version: 2 });

  const r = await api('get', `/reportes/cotizaciones-fuera-de-rango?desde=${hoy()}&hasta=${hoy()}`, a.jwt.admin);
  assert.deepEqual(r.body.cotizaciones.map((c) => [c.id, c.tarifa.version]), [[vieja, 1]]);
  assert.equal(r.body.totales.evaluadas, 2);
  assert.ok(!r.body.cotizaciones.some((c) => c.id === nueva));
});

test('887 C2: un periodo sin cotizaciones es vacío controlado y si Rules no responde el reporte da 503 sin valores', opts, async (t) => {
  const { pool, rules } = await entorno(t);
  const a = await sembrarTenant(pool);

  const vacio = await api('get', '/reportes/cotizaciones-fuera-de-rango?desde=2020-01-01&hasta=2020-01-31', a.jwt.admin);
  assert.equal(vacio.status, 200);
  assert.deepEqual(vacio.body.totales, { cotizaciones: 0, evaluadas: 0, sinTarifa: 0, fueraDeRango: 0 });
  assert.deepEqual(vacio.body.cotizaciones, []);

  await api('post', '/tarifas', a.jwt.admin).send(tarifaBase(a.categoria));
  await cotizar(pool, a, { total: 1 });
  rules.respondWith(() => ({ status: 503, body: {} }));
  const caido = await api('get', `/reportes/cotizaciones-fuera-de-rango?desde=${hoy()}&hasta=${hoy()}`, a.jwt.admin);
  assert.equal(caido.status, 503);
  assert.equal(caido.body.code, 'RULES_SERVICE_UNAVAILABLE');
  assert.equal(caido.body.cotizaciones, undefined);
});

test('887 C3: el reporte es solo del administrador y solo de su tenant', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  await api('post', '/tarifas', a.jwt.admin).send(tarifaBase(a.categoria));
  await cotizar(pool, a, { total: 1 });

  for (const jwtSesion of [a.jwt.cliente, a.jwt.aliado]) {
    assert.equal((await api('get', `/reportes/cotizaciones-fuera-de-rango?desde=${hoy()}&hasta=${hoy()}`, jwtSesion)).status, 403);
  }
  const deB = await api('get', `/reportes/cotizaciones-fuera-de-rango?desde=${hoy()}&hasta=${hoy()}`, b.jwt.admin);
  assert.equal(deB.status, 200);
  assert.deepEqual(deB.body.totales, { cotizaciones: 0, evaluadas: 0, sinTarifa: 0, fueraDeRango: 0 });
});

// =============================================================== SCRUM-895 · HU-M12-01
const quejaValida = { motivo: 'INCUMPLIMIENTO_DE_HORARIO', descripcion: 'El aliado llegó dos horas tarde sin avisar' };

test('895 C1: el cliente presenta una queja ligada a su servicio con motivo y queda ABIERTA con su primera transición', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);

  const r = await api('post', `/solicitudes/${a.solicitud}/quejas`, a.jwt.cliente, 'corr-895').send(quejaValida);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.queja.estado, 'ABIERTA');
  assert.equal(r.body.queja.solicitudId, a.solicitud);
  assert.equal(r.body.queja.motivo, 'INCUMPLIMIENTO_DE_HORARIO');
  assert.deepEqual(r.body.queja.historial.map((h) => [h.estadoAnterior, h.estadoNuevo, h.actor.rol]), [[null, 'ABIERTA', 'CLIENT']]);

  const fila = (await pool.query('SELECT * FROM queja WHERE id = $1', [r.body.queja.id])).rows[0];
  assert.equal(fila.tenant_id, a.id);
  assert.equal(fila.cliente_id, a.cliente.id);
  assert.equal(fila.creado_por, a.cliente.usuario);
  assert.equal(fila.correlation_id, 'corr-895');

  // Persistida: la vuelve a ver al consultar.
  const mias = await api('get', '/quejas/mias', a.jwt.cliente);
  assert.deepEqual(mias.body.quejas.map((q) => q.id), [r.body.queja.id]);
  // Sobre un servicio cancelado con aliado también se puede quejar el cliente dueño.
  const cancelada = await api('post', `/solicitudes/${a.solicitudOtroCliente}/quejas`, a.jwt.otroCliente).send(quejaValida);
  assert.equal(cancelada.status, 201);
});

test('895 C2: campos inválidos, servicio ajeno, sin aliado o una segunda queja abierta se rechazan sin crear filas', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  const contar = async () => (await pool.query('SELECT count(*)::int AS n FROM queja WHERE tenant_id = $1', [a.id])).rows[0].n;

  for (const body of [{}, { motivo: 'MOLESTIA', descripcion: quejaValida.descripcion }, { motivo: 'OTRO', descripcion: 'corta' }]) {
    const r = await api('post', `/solicitudes/${a.solicitud}/quejas`, a.jwt.cliente).send(body);
    assert.equal(r.status, 400);
    assert.equal(r.body.code, 'MANI-QJA-400');
  }
  // Servicio de otro cliente del mismo tenant o de otro tenant: responde como inexistente.
  for (const [jwtSesion, solicitud] of [[a.jwt.otroCliente, a.solicitud], [b.jwt.cliente, a.solicitud], [a.jwt.cliente, uuid()]]) {
    const r = await api('post', `/solicitudes/${solicitud}/quejas`, jwtSesion).send(quejaValida);
    assert.equal(r.status, 404);
    assert.equal(r.body.code, 'MANI-QJA-404S');
  }
  const sinAliado = await api('post', `/solicitudes/${a.solicitudSinAliado}/quejas`, a.jwt.cliente).send(quejaValida);
  assert.equal(sinAliado.status, 409);
  assert.equal(sinAliado.body.code, 'MANI-QJA-409S');
  assert.equal(await contar(), 0);

  assert.equal((await api('post', `/solicitudes/${a.solicitud}/quejas`, a.jwt.cliente).send(quejaValida)).status, 201);
  const segunda = await api('post', `/solicitudes/${a.solicitud}/quejas`, a.jwt.cliente).send(quejaValida);
  assert.equal(segunda.status, 409);
  assert.equal(segunda.body.code, 'MANI-QJA-409A');
  assert.equal(await contar(), 1);
});

test('895 C3: aliado y administrador no presentan quejas; cada cliente solo ve las suyas', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const queja = (await api('post', `/solicitudes/${a.solicitud}/quejas`, a.jwt.cliente).send(quejaValida)).body.queja;

  for (const jwtSesion of [a.jwt.aliado, a.jwt.admin]) {
    assert.equal((await api('post', `/solicitudes/${a.solicitud}/quejas`, jwtSesion).send(quejaValida)).status, 403);
  }
  assert.deepEqual((await api('get', '/quejas/mias', a.jwt.otroCliente)).body.quejas, []);
  const ajena = await api('get', `/quejas/${queja.id}`, a.jwt.otroCliente);
  assert.equal(ajena.status, 404);
  assert.equal((await api('get', `/quejas/${queja.id}`, a.jwt.cliente)).status, 200);
  assert.equal((await api('get', '/quejas/mias', a.jwt.aliado)).status, 403);
});

// =============================================================== SCRUM-896 · HU-M12-02
test('896 C1: el administrador cambia el estado y cada transición queda con actor, rol, fecha, nota y correlación', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const queja = (await api('post', `/solicitudes/${a.solicitud}/quejas`, a.jwt.cliente).send(quejaValida)).body.queja;

  const lista = await api('get', '/quejas?estado=ABIERTA', a.jwt.admin);
  assert.deepEqual(lista.body.quejas.map((q) => q.id), [queja.id]);

  const revision = await api('patch', `/quejas/${queja.id}/estado`, a.jwt.admin, 'corr-896-a').send({ estado: 'EN_REVISION' });
  assert.equal(revision.status, 200, JSON.stringify(revision.body));
  assert.equal(revision.body.queja.estado, 'EN_REVISION');
  const resuelta = await api('patch', `/quejas/${queja.id}/estado`, a.jwt.admin, 'corr-896-b').send({ estado: 'RESUELTA', nota: 'Se aplicó un descuento al cliente' });
  assert.equal(resuelta.status, 200);
  assert.equal(resuelta.body.queja.respuesta, 'Se aplicó un descuento al cliente');

  const historial = (await pool.query('SELECT * FROM queja_transicion WHERE queja_id = $1 ORDER BY created_at', [queja.id])).rows;
  assert.deepEqual(historial.map((h) => [h.estado_anterior, h.estado_nuevo, h.actor_rol, h.correlation_id]), [
    [null, 'ABIERTA', 'CLIENT', historial[0].correlation_id],
    ['ABIERTA', 'EN_REVISION', 'ADMIN', 'corr-896-a'],
    ['EN_REVISION', 'RESUELTA', 'ADMIN', 'corr-896-b'],
  ]);
  assert.equal(historial[2].actor_id, a.admin.usuario);
  assert.equal(historial[2].nota, 'Se aplicó un descuento al cliente');
  assert.ok(historial[2].created_at instanceof Date);
  // El cliente ve la respuesta y el historial; y le llega el aviso a su bandeja.
  const vista = await api('get', `/quejas/${queja.id}`, a.jwt.cliente);
  assert.equal(vista.body.queja.estado, 'RESUELTA');
  assert.equal(vista.body.queja.historial.length, 3);
  const avisos = (await pool.query("SELECT payload FROM notificacion WHERE usuario_id = $1 AND tipo = 'QUEJA_ACTUALIZADA'", [a.cliente.usuario])).rows;
  assert.deepEqual(avisos.map((x) => x.payload.estado).sort(), ['EN_REVISION', 'RESUELTA']);
});

test('896 C2: una transición inválida no modifica el estado ni deja registro, tampoco escribiendo directo en la base', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const queja = (await api('post', `/solicitudes/${a.solicitud}/quejas`, a.jwt.cliente).send(quejaValida)).body.queja;
  await api('patch', `/quejas/${queja.id}/estado`, a.jwt.admin).send({ estado: 'RECHAZADA', nota: 'No procede: el servicio se cumplió' });
  const estado = async () => (await pool.query('SELECT estado, respuesta FROM queja WHERE id = $1', [queja.id])).rows[0];
  const transiciones = async () => (await pool.query('SELECT count(*)::int AS n FROM queja_transicion WHERE queja_id = $1', [queja.id])).rows[0].n;
  const antes = { estado: await estado(), n: await transiciones() };

  for (const body of [{ estado: 'EN_REVISION' }, { estado: 'ABIERTA' }, { estado: 'RESUELTA', nota: 'Intento posterior' }]) {
    const r = await api('patch', `/quejas/${queja.id}/estado`, a.jwt.admin).send(body);
    assert.equal(r.status, 409, JSON.stringify(body));
    assert.equal(r.body.code, 'MANI-QJA-409T');
  }
  const sinNota = await api('patch', `/quejas/${queja.id}/estado`, a.jwt.admin).send({ estado: 'RESUELTA' });
  assert.equal(sinNota.status, 400);
  assert.deepEqual({ estado: await estado(), n: await transiciones() }, antes);

  // El disparador de la 0030 rechaza la transición aunque se salte la aplicación (incluso el dueño de la tabla).
  await assert.rejects(() => pool.query("UPDATE queja SET estado = 'ABIERTA' WHERE id = $1", [queja.id]), /MANI-QJA-409T/);
  await assert.rejects(() => pool.query("UPDATE queja SET descripcion = 'cambiada a mano' WHERE id = $1", [queja.id]), /MANI-QJA-409I/);
  await assert.rejects(() => pool.query('DELETE FROM queja_transicion WHERE queja_id = $1', [queja.id]), /inmutable/);
});

test('896 C3: ningún usuario administra quejas de otro tenant; el cliente no cambia estados ni por la base', opts, async (t) => {
  const { pool, corePool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  const queja = (await api('post', `/solicitudes/${a.solicitud}/quejas`, a.jwt.cliente).send(quejaValida)).body.queja;

  assert.deepEqual((await api('get', '/quejas', b.jwt.admin)).body.quejas, []);
  const ajena = await api('patch', `/quejas/${queja.id}/estado`, b.jwt.admin).send({ estado: 'EN_REVISION' });
  assert.equal(ajena.status, 404);
  assert.equal((await api('get', `/quejas/${queja.id}`, b.jwt.admin)).status, 404);
  assert.equal((await api('patch', `/quejas/${queja.id}/estado`, a.jwt.cliente).send({ estado: 'EN_REVISION' })).status, 403);
  assert.equal((await api('get', '/quejas', a.jwt.aliado)).status, 403);

  // RLS: con el rol del cliente (o con el admin de B) el UPDATE no alcanza la fila.
  for (const ctx of [{ tenantId: a.id, userId: a.cliente.usuario, role: 'cliente' }, { tenantId: b.id, userId: b.admin.usuario, role: 'admin_tenant' }]) {
    const { rowCount } = await withTenantContext(corePool, ctx, (c) => c.query("UPDATE queja SET estado = 'EN_REVISION' WHERE id = $1", [queja.id]));
    assert.equal(rowCount, 0, ctx.role);
  }
  assert.equal((await pool.query('SELECT estado FROM queja WHERE id = $1', [queja.id])).rows[0].estado, 'ABIERTA');
});

// =============================================================== SCRUM-900 · HU-M12-06
test('900 C1/C3: el administrador consulta los agregados de su tenant en el periodo, sin mezclar otro tenant', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  await cotizar(pool, a, { total: 100000, estado: 'ACEPTADA' });
  await cotizar(pool, a, { solicitud: a.solicitudSinTarifa, total: 50000, estado: 'RECHAZADA' });
  await cotizar(pool, b, { total: 1, estado: 'ACEPTADA' });
  await pool.query('INSERT INTO calificacion (tenant_id, solicitud_id, autor_id, destinatario_id, puntaje) VALUES ($1, $2, $3, $4, 4), ($1, $2, $4, $3, 5)', [a.id, a.solicitudSinTarifa, a.cliente.usuario, a.aliado.usuario]);
  await api('post', `/solicitudes/${a.solicitud}/quejas`, a.jwt.cliente).send(quejaValida);

  const r = await api('get', `/metricas/operativas?desde=${hoy()}&hasta=${hoy()}`, a.jwt.admin);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.solicitudes, {
    creadas: 4,
    porEstado: { CANCELADA: 1, COTIZANDO: 1, FINALIZADA: 1, PENDIENTE: 1 },
    finalizadas: 1,
    canceladas: 1,
    tasaCancelacion: 0.25,
  });
  assert.deepEqual(r.body.cotizaciones, { emitidas: 2, aceptadas: 1, tasaAceptacion: 0.5 });
  assert.deepEqual(r.body.calificaciones, { total: 2, promedio: 4.5 });
  assert.deepEqual(r.body.quejas, { registradas: 1, abiertas: 1, cerradas: 0 });
  assert.equal(r.body.aliadosConServicios, 1);
  assert.deepEqual(r.body.periodo, { desde: hoy(), hasta: hoy(), zonaHoraria: 'America/Bogota' });

  // B solo ve lo suyo (4 solicitudes sembradas y 1 cotización aceptada), nunca los datos de A.
  const deB = await api('get', `/metricas/operativas?desde=${hoy()}&hasta=${hoy()}`, b.jwt.admin);
  assert.deepEqual(deB.body.cotizaciones, { emitidas: 1, aceptadas: 1, tasaAceptacion: 1 });
  assert.deepEqual(deB.body.quejas, { registradas: 0, abiertas: 0, cerradas: 0 });
});

test('900 C2: un periodo sin datos devuelve ceros y tasas nulas reales; cliente y aliado reciben 403', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);

  const r = await api('get', '/metricas/operativas?desde=2020-01-01&hasta=2020-12-31', a.jwt.admin);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.solicitudes, { creadas: 0, porEstado: {}, finalizadas: 0, canceladas: 0, tasaCancelacion: null });
  assert.deepEqual(r.body.cotizaciones, { emitidas: 0, aceptadas: 0, tasaAceptacion: null });
  assert.deepEqual(r.body.pagos, { aprobados: 0, montoAprobado: 0 });
  assert.deepEqual(r.body.calificaciones, { total: 0, promedio: null });
  for (const jwtSesion of [a.jwt.cliente, a.jwt.aliado]) {
    assert.equal((await api('get', '/metricas/operativas?desde=2020-01-01&hasta=2020-01-02', jwtSesion)).status, 403);
  }
  assert.equal((await api('get', '/metricas/operativas?desde=2020-02-01&hasta=2020-01-01', a.jwt.admin)).status, 400);
});

// =============================================================== SCRUM-901 · HU-M12-07
test('901 C1: el administrador de plataforma suspende y reactiva un tenant con motivo; cada cambio queda registrado', opts, async (t) => {
  const { pool } = await entorno(t);
  const plataforma = await sembrarTenant(pool);
  const objetivo = await sembrarTenant(pool);

  const suspender = await api('patch', `/tenants/${objetivo.id}/estado`, plataforma.jwt.plataforma, 'corr-901').send({ estado: 'SUSPENDED', motivo: 'Mora de dos meses en el plan' });
  assert.equal(suspender.status, 200, JSON.stringify(suspender.body));
  assert.equal(suspender.body.tenant.status, 'SUSPENDED');
  assert.equal(suspender.body.cambio.estadoAnterior, 'ACTIVE');
  assert.equal((await pool.query('SELECT estado FROM tenant WHERE id = $1', [objetivo.id])).rows[0].estado, 'SUSPENDIDO');

  const reactivar = await api('patch', `/tenants/${objetivo.id}/estado`, plataforma.jwt.plataforma).send({ estado: 'ACTIVE', motivo: 'Pago del plan recibido' });
  assert.equal(reactivar.status, 200);

  const historial = await api('get', `/tenants/${objetivo.id}/estado/historial`, plataforma.jwt.plataforma);
  assert.deepEqual(historial.body.cambios.map((c) => [c.estadoAnterior, c.estadoNuevo]), [['SUSPENDED', 'ACTIVE'], ['ACTIVE', 'SUSPENDED']]);
  const fila = (await pool.query('SELECT * FROM tenant_estado_cambio WHERE tenant_id = $1 AND estado_nuevo = $2', [objetivo.id, 'SUSPENDIDO'])).rows[0];
  assert.equal(fila.actor_id, plataforma.plataforma.usuario);
  assert.equal(fila.actor_rol, 'PLATFORM_ADMIN');
  assert.equal(fila.actor_tenant_id, plataforma.id);
  assert.equal(fila.motivo, 'Mora de dos meses en el plan');
  assert.equal(fila.correlation_id, 'corr-901');

  const repetido = await api('patch', `/tenants/${objetivo.id}/estado`, plataforma.jwt.plataforma).send({ estado: 'ACTIVE', motivo: 'Pago del plan recibido' });
  assert.equal(repetido.status, 409);
  assert.equal(repetido.body.code, 'MANI-TEN-409');
  assert.equal((await api('patch', `/tenants/${uuid()}/estado`, plataforma.jwt.plataforma).send({ estado: 'ACTIVE', motivo: 'Motivo suficiente' })).status, 404);
  assert.equal((await api('patch', `/tenants/${objetivo.id}/estado`, plataforma.jwt.plataforma).send({ estado: 'SUSPENDED' })).status, 400);
});

test('901 C2/C3: admin_tenant, cliente y aliado no suspenden tenants ni ven el historial o la lista global; tampoco por la base', opts, async (t) => {
  const { pool, corePool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);

  for (const jwtSesion of [a.jwt.admin, a.jwt.cliente, a.jwt.aliado]) {
    assert.equal((await api('patch', `/tenants/${a.id}/estado`, jwtSesion).send({ estado: 'SUSPENDED', motivo: 'Intento sin permiso' })).status, 403);
    assert.equal((await api('patch', `/tenants/${b.id}/estado`, jwtSesion).send({ estado: 'SUSPENDED', motivo: 'Intento sin permiso' })).status, 403);
    assert.equal((await api('get', `/tenants/${a.id}/estado/historial`, jwtSesion)).status, 403);
    assert.equal((await api('get', '/tenants', jwtSesion)).status, 403);
  }
  // RLS (0031): con el rol admin_tenant el UPDATE no alcanza ni su propio tenant y el registro no admite filas.
  const ctx = { tenantId: a.id, userId: a.admin.usuario, role: 'admin_tenant' };
  const { rowCount } = await withTenantContext(corePool, ctx, (c) => c.query("UPDATE tenant SET estado = 'SUSPENDIDO' WHERE id = $1", [a.id]));
  assert.equal(rowCount, 0);
  await assert.rejects(
    () => withTenantContext(corePool, ctx, (c) => c.query("INSERT INTO tenant_estado_cambio (tenant_id, estado_anterior, estado_nuevo, motivo, actor_id, actor_rol, actor_tenant_id) VALUES ($1, 'ACTIVO', 'SUSPENDIDO', 'Intento directo', $2, 'ADMIN', $1)", [a.id, a.admin.usuario])),
    /row-level security/
  );
  // Ni el rol de servicio puede cambiar otra columna del tenant.
  await assert.rejects(
    () => withTenantContext(corePool, { ...ctx, role: 'admin_plataforma' }, (c) => c.query("UPDATE tenant SET nombre = 'Otro' WHERE id = $1", [a.id])),
    /permission denied/
  );
  assert.equal((await pool.query('SELECT estado FROM tenant WHERE id = $1', [a.id])).rows[0].estado, 'ACTIVO');
});
