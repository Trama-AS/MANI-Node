const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const app = require('../../../src/app');
const config = require('../../../src/config');
const { resetMetrics, getMetrics } = require('../../../src/infrastructure/observability/metrics');

const SECRET = config.supabaseJwtSecret || 'dev-insecure-secret-for-local-testing-only-replace-in-production-32chars!';

test.beforeEach(() => {
  resetMetrics();
});

test('GET /metrics responde 200 con formato canónico Prometheus y Content-Type text/plain', async () => {
  const res = await request(app).get('/metrics');

  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/plain/);
  assert.match(res.text, /# HELP http_requests_total/);
  assert.match(res.text, /# HELP auth_validations_total/);
  assert.match(res.text, /# HELP process_cpu_user_seconds_total/);
});

test('GET /api/v1/metrics también responde 200 con las métricas expuestas', async () => {
  const res = await request(app).get('/api/v1/metrics');

  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /text\/plain/);
  assert.match(res.text, /auth_validations_total/);
});

test('Petición que devuelve 401 incrementa http_requests_total con status_code="401"', async () => {
  const res401 = await request(app)
    .get('/api/v1/auth/validate-token');

  assert.equal(res401.status, 401);

  const metrics = await getMetrics();
  assert.match(metrics, /http_requests_total\{[^}]*status_code="401"[^}]*\}/);
  assert.match(metrics, /auth_validations_total\{[^}]*result="failure"[^}]*reason="missing_authorization_header"[^}]*\}/);
});

test('Token sin claim app_metadata.tenant_id incrementa auth_validations_total con reason="missing_tenant_claim"', async () => {
  const tokenSinTenant = jwt.sign(
    { sub: 'usr-no-tenant', role: 'authenticated', app_metadata: { user_role: 'aliado' } },
    SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  const res = await request(app)
    .get('/api/v1/auth/validate-token')
    .set('Authorization', `Bearer ${tokenSinTenant}`);

  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'MISSING_TENANT_CLAIM');

  const metrics = await getMetrics();
  assert.match(metrics, /auth_validations_total\{[^}]*result="failure"[^}]*reason="missing_tenant_claim"[^}]*\}\s+1/);
});

test('Token sin claim app_metadata.user_role incrementa auth_validations_total con reason="missing_user_role"', async () => {
  const tokenSinRol = jwt.sign(
    { sub: 'usr-no-role', role: 'authenticated', app_metadata: { tenant_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11' } },
    SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  const res = await request(app)
    .get('/api/v1/auth/validate-token')
    .set('Authorization', `Bearer ${tokenSinRol}`);

  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'INVALID_TOKEN');

  const metrics = await getMetrics();
  assert.match(metrics, /auth_validations_total\{[^}]*result="failure"[^}]*reason="missing_user_role"[^}]*\}\s+1/);
});

test('Token válido con todos los claims incrementa auth_validations_total con result="success" y reason="ok"', async () => {
  const tokenValido = jwt.sign(
    {
      sub: 'usr-valido-1',
      role: 'authenticated',
      app_metadata: { tenant_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', user_role: 'aliado' },
    },
    SECRET,
    { algorithm: 'HS256', expiresIn: '1h' }
  );

  const res = await request(app)
    .get('/api/v1/auth/validate-token')
    .set('Authorization', `Bearer ${tokenValido}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.valid, true);

  const metrics = await getMetrics();
  assert.match(metrics, /auth_validations_total\{[^}]*result="success"[^}]*reason="ok"[^}]*\}\s+1/);
  assert.match(metrics, /http_requests_total\{[^}]*status_code="200"[^}]*\}/);
});
