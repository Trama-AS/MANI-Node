const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const config = require('../../../src/config');

function registerRequest(overrides = {}) {
  const unique = `${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const req = request(app)
    .post('/api/v1/auth/register/ally')
    .set('X-Tenant-Id', overrides.tenantId ?? 'trama-demo')
    .field('fullName', overrides.fullName ?? 'Maria Fernanda Rojas')
    .field('email', overrides.email ?? `aliado.${unique}@mani.test`)
    .field('password', overrides.password ?? 'Cambiar123!')
    .field('categoriaId', overrides.categoriaId ?? 'cat-1');

  if (overrides.attachCedula !== false) {
    req.attach('cedula_ciudadania', Buffer.from('contenido-fake-cedula'), 'cedula.pdf');
  }

  return req;
}

test('POST /api/v1/auth/register/ally responde 201 con profile ALLY/PENDING y tokens válidos', async () => {
  const res = await registerRequest();

  assert.equal(res.status, 201);
  assert.equal(res.body.profile.role, 'ALLY');
  assert.equal(res.body.profile.status, 'PENDING');
  assert.equal(res.body.profile.tenantId, 'trama-demo');
  assert.ok(res.body.tokens.accessToken);
  assert.ok(res.body.tokens.refreshToken);

  const claims = jwt.verify(res.body.tokens.accessToken, config.supabaseJwtSecret, { algorithms: ['HS256'] });
  assert.equal(claims.app_metadata.tenant_id, 'trama-demo');
  assert.equal(claims.app_metadata.user_role, 'aliado');
});

test('POST /api/v1/auth/register/ally sin X-Tenant-Id responde 400 VALIDATION_ERROR', async () => {
  const res = await request(app)
    .post('/api/v1/auth/register/ally')
    .field('fullName', 'x')
    .field('email', 'x@mani.test')
    .field('password', 'Cambiar123!')
    .field('categoriaId', 'cat-1')
    .attach('cedula_ciudadania', Buffer.from('x'), 'cedula.pdf');

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/auth/register/ally sin documentos KYC responde 400 VALIDATION_ERROR', async () => {
  const res = await registerRequest({ attachCedula: false });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/auth/register/ally con tenant inexistente responde 400 TENANT_NOT_FOUND', async () => {
  const res = await registerRequest({ tenantId: 'tenant-que-no-existe' });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'TENANT_NOT_FOUND');
});

test('POST /api/v1/auth/register/ally con categoriaId inexistente responde 400 CATEGORY_NOT_FOUND', async () => {
  const res = await registerRequest({ categoriaId: 'cat-no-existe' });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'CATEGORY_NOT_FOUND');
});

test('POST /api/v1/auth/register/ally repetido con el mismo email responde 409 EMAIL_ALREADY_REGISTERED', async () => {
  const email = `aliado.dup.${Date.now()}@mani.test`;

  const first = await registerRequest({ email });
  assert.equal(first.status, 201);

  const second = await registerRequest({ email });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'EMAIL_ALREADY_REGISTERED');
});
