// Prueba maestra del módulo M-10 (SCRUM-885, 886, 887): cada criterio C1-C3 se verifica por HTTP contra la app real
// (JWT -> authenticate -> caso de uso -> repositorio pg) y PostgreSQL real, conectado como `mani_core_svc` (sin
// BYPASSRLS) para que RLS y el disparador de inmutabilidad de la migración 0030 sí se evalúen.
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
const TariffsUseCase = require('../../../src/application/useCases/tariffs/TariffsUseCase');
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

/** Monta el caso de uso de M-10 con repositorios pg (como mani_core_svc) y Rules de prueba; restaura al terminar. */
async function entorno(t) {
  const admin = new PgPoolFactory({ databaseUrl: url });
  const core = new PgPoolFactory({ databaseUrl: comoCore(url) });
  const rules = await startFakeRulesService();
  rules.respondWith(rulesDeTarifas);
  const ruleEvaluationService = new RulesServiceHttpClient({ baseUrl: rules.url, retries: 0 });
  const originales = {};
  const nuevos = {
    tariffsUseCase: new TariffsUseCase({ tariffRepository: new PgTariffRepository({ pgPoolFactory: core }), ruleEvaluationService }),
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
