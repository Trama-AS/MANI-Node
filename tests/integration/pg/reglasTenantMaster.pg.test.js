// Prueba maestra de SCRUM-1366 (HU-M01-03): reglas operativas propias por tenant. Cada criterio C1-C3 se verifica por
// HTTP contra la app real (JWT -> authenticate -> caso de uso -> repositorio pg) y PostgreSQL real, conectado como
// `mani_core_svc` (sin BYPASSRLS) para que RLS y el disparador de inmutabilidad de la migración 0031 sí se evalúen.
// Rules es un doble HTTP que habla el contrato de POST /api/v1/rules/tenant-rules/validate. Se omite sin TEST_DATABASE_URL.
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
const PgTenantRulesRepository = require('../../../src/infrastructure/repositories/PgTenantRulesRepository');
const TenantRulesUseCase = require('../../../src/application/useCases/tenantRules/TenantRulesUseCase');
const { withTenantContext } = require('../../../src/infrastructure/db/withTenantContext');
const { startFakeRulesService } = require('../../helpers/fakeRulesService');

const url = process.env.TEST_DATABASE_URL;
const opts = { skip: url ? false : 'TEST_DATABASE_URL no configurada' };
const uuid = () => crypto.randomUUID();
const comoCore = (u) => `${u}${u.includes('?') ? '&' : '?'}options=-c%20role%3Dmani_core_svc`;

// Doble de Rules: aplica la misma política que TenantRulesValidator de MANI-Java para el criterio de orden.
function rulesDeReglas({ body, headers }) {
  if (!headers['x-tenant-id'] || !headers['x-user-role']) return { status: 400, body: { code: 'TENANT_REQUIRED' } };
  const criterio = body.rules && body.rules.ordenListado && body.rules.ordenListado.criterio;
  const violations = ['CALIFICACION', 'COBERTURA'].includes(criterio) ? [] : ['ordenListado.criterio debe ser CALIFICACION o COBERTURA'];
  return { status: 200, body: { valid: violations.length === 0, version: 'tenant-rules-v1', violations } };
}

const token = (sub, tenant, role) =>
  `Bearer ${jwt.sign({ sub, app_metadata: { tenant_id: tenant, user_role: role } }, config.supabaseJwtSecret, { algorithm: 'HS256', expiresIn: '1h' })}`;

async function sembrarTenant(pool) {
  const t = { id: uuid(), admin: uuid(), cliente: uuid(), aliado: uuid() };
  await pool.query("INSERT INTO tenant (id, nombre, slug, estado) VALUES ($1, 'T', $2, 'ACTIVO')", [t.id, `t-${t.id}`]);
  for (const [id, rol] of [[t.admin, 'ADMIN_TENANT'], [t.cliente, 'CLIENTE'], [t.aliado, 'ALIADO']]) {
    await pool.query("INSERT INTO usuario (id, tenant_id, email, rol, estado) VALUES ($1, $2, $3, $4, 'ACTIVO')", [id, t.id, `${id}@t.test`, rol]);
  }
  t.jwt = {
    admin: token(t.admin, t.id, 'admin_tenant'),
    cliente: token(t.cliente, t.id, 'cliente'),
    aliado: token(t.aliado, t.id, 'aliado'),
  };
  return t;
}

async function entorno(t) {
  const admin = new PgPoolFactory({ databaseUrl: url });
  const core = new PgPoolFactory({ databaseUrl: comoCore(url) });
  const rules = await startFakeRulesService();
  rules.respondWith(rulesDeReglas);
  const original = container.tenantRulesUseCase;
  container.tenantRulesUseCase = new TenantRulesUseCase({
    tenantRulesRepository: new PgTenantRulesRepository({ pgPoolFactory: core }),
    ruleEvaluationService: new RulesServiceHttpClient({ baseUrl: rules.url, retries: 0 }),
  });
  t.after(async () => {
    container.tenantRulesUseCase = original;
    await Promise.all([admin.close(), core.close(), rules.close()]);
  });
  return { pool: admin.getPool(), corePool: core.getPool(), rules };
}

const api = (metodo, auth, body, corr = `corr-${crypto.randomUUID().slice(0, 8)}`) => {
  const r = request(app)[metodo]('/api/v1/tenant/rules').set('Authorization', auth).set('X-Correlation-ID', corr);
  return body ? r.send(body) : r;
};

const REGLAS = {
  ordenListado: { criterio: 'COBERTURA' },
  alertaTarifa: { toleranciaPorcentaje: 15 },
  comision: { porcentaje: 10 },
  cancelacion: { ventanaHoras: 4, penalizacionPorcentaje: 25 },
  oferta: { minutosParaAceptar: 30 },
};

test('1366 C1: sin configuración GET /tenant/rules responde version 0, origen POR_OMISION y criterio CALIFICACION', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);

  for (const auth of [a.jwt.admin, a.jwt.cliente, a.jwt.aliado]) {
    const r = await api('get', auth);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.version, 0);
    assert.equal(r.body.origen, 'POR_OMISION');
    assert.equal(r.body.reglas.ordenListado.criterio, 'CALIFICACION');
  }
});

test('1366 C1: el administrador guarda la v1 y luego la v2; la vigente cambia y el historial conserva ambas con auditoría', opts, async (t) => {
  const { pool, rules } = await entorno(t);
  const a = await sembrarTenant(pool);

  const v1 = await api('put', a.jwt.admin, { expectedVersion: 0, reglas: REGLAS }, 'corr-1366-v1');
  assert.equal(v1.status, 200, JSON.stringify(v1.body));
  assert.equal(v1.body.version, 1);
  assert.equal(v1.body.origen, 'PROPIO');
  assert.equal(v1.body.reglas.ordenListado.criterio, 'COBERTURA');
  const v2 = await api('put', a.jwt.admin, { expectedVersion: 1, reglas: { ...REGLAS, ordenListado: { criterio: 'calificacion' } } });
  assert.equal(v2.status, 200);
  assert.equal(v2.body.version, 2);

  // Persistido: el aliado (que lo usa Dispatch al ordenar) ve la versión 2 con el criterio normalizado.
  const vigente = await api('get', a.jwt.aliado);
  assert.deepEqual([vigente.body.version, vigente.body.reglas.ordenListado.criterio], [2, 'CALIFICACION']);
  const historial = await request(app).get('/api/v1/tenant/rules/history').set('Authorization', a.jwt.admin);
  assert.deepEqual(historial.body.items.map((i) => [i.version, i.estado]), [[2, 'VIGENTE'], [1, 'HISTORICA']]);

  const fila = (await pool.query('SELECT creado_por, actor_rol, correlation_id FROM regla_tenant WHERE tenant_id = $1 AND version = 1', [a.id])).rows[0];
  assert.deepEqual({ ...fila }, { creado_por: a.admin, actor_rol: 'ADMIN', correlation_id: 'corr-1366-v1' });
  const enviado = rules.requests.find((x) => x.url === '/api/v1/rules/tenant-rules/validate');
  assert.equal(enviado.headers['x-tenant-id'], a.id);
  assert.equal(enviado.body.rules.ordenListado.criterio, 'COBERTURA');
});

test('1366 C2: versión desactualizada (409), valores inválidos (400), reglas que Rules rechaza (422) o Rules caído (503) no cambian la vigente', opts, async (t) => {
  const { pool, rules } = await entorno(t);
  const a = await sembrarTenant(pool);
  await api('put', a.jwt.admin, { expectedVersion: 0, reglas: REGLAS });
  const filas = async () => (await pool.query('SELECT version, estado FROM regla_tenant WHERE tenant_id = $1 ORDER BY version', [a.id])).rows;
  const antes = await filas();

  const vieja = await api('put', a.jwt.admin, { expectedVersion: 0, reglas: REGLAS });
  assert.equal(vieja.status, 409);
  assert.equal(vieja.body.code, 'MANI-RGL-409C');
  const invalida = await api('put', a.jwt.admin, { expectedVersion: 1, reglas: { ...REGLAS, comision: { porcentaje: 80 } } });
  assert.equal(invalida.status, 400);
  assert.equal(invalida.body.code, 'MANI-RGL-400');

  rules.respondWith(() => ({ status: 200, body: { valid: false, version: 'tenant-rules-v1', violations: ['regla incompatible'] } }));
  const rechazada = await api('put', a.jwt.admin, { expectedVersion: 1, reglas: REGLAS });
  assert.equal(rechazada.status, 422);
  assert.equal(rechazada.body.code, 'RULES_VALIDATION_ERROR');

  rules.respondWith(() => ({ status: 503, body: {} }));
  const caido = await api('put', a.jwt.admin, { expectedVersion: 1, reglas: REGLAS });
  assert.equal(caido.status, 503);
  assert.equal(caido.body.code, 'RULES_SERVICE_UNAVAILABLE');

  assert.deepEqual(await filas(), antes);
});

test('1366 C3: cliente y aliado no modifican; otro tenant no ve ni altera las reglas de A, tampoco por la base', opts, async (t) => {
  const { pool, corePool } = await entorno(t);
  const a = await sembrarTenant(pool);
  const b = await sembrarTenant(pool);
  await api('put', a.jwt.admin, { expectedVersion: 0, reglas: REGLAS });

  for (const auth of [a.jwt.cliente, a.jwt.aliado]) {
    assert.equal((await api('put', auth, { expectedVersion: 1, reglas: REGLAS })).status, 403);
  }
  const deB = await api('get', b.jwt.admin);
  assert.deepEqual([deB.body.version, deB.body.origen], [0, 'POR_OMISION'], 'B sigue con la configuración por omisión');
  assert.equal((await api('put', b.jwt.admin, { expectedVersion: 0, reglas: REGLAS })).body.version, 1, 'B versiona por su lado');

  const ctxB = { tenantId: b.id, userId: b.admin, role: 'admin_tenant' };
  const { rowCount } = await withTenantContext(corePool, ctxB, (c) => c.query("UPDATE regla_tenant SET estado = 'HISTORICA' WHERE tenant_id = $1", [a.id]));
  assert.equal(rowCount, 0, 'RLS: B no alcanza las filas de A');
  assert.equal((await pool.query("SELECT estado FROM regla_tenant WHERE tenant_id = $1", [a.id])).rows[0].estado, 'VIGENTE');
});

test('1366 T10: una versión es inmutable y no se borra, aun para el dueño de la tabla', opts, async (t) => {
  const { pool } = await entorno(t);
  const a = await sembrarTenant(pool);
  await api('put', a.jwt.admin, { expectedVersion: 0, reglas: REGLAS });

  await assert.rejects(() => pool.query("UPDATE regla_tenant SET reglas = '{}'::jsonb WHERE tenant_id = $1", [a.id]), /MANI-RGL-409T|MANI-RGL-409C/);
  await assert.rejects(() => pool.query('DELETE FROM regla_tenant WHERE tenant_id = $1', [a.id]), /MANI-RGL-409I/);
});
