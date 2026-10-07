const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const config = require('../../../src/config');

function validBody(overrides = {}) {
  return {
    fullName: 'Maria Fernanda Rojas',
    email: `aliado.${Date.now()}.${Math.random().toString(36).slice(2)}@mani.test`,
    password: 'Cambiar123!',
    phone: '+573001234567',
    documentType: 'CC',
    documentNumber: `${Date.now()}${Math.floor(Math.random() * 1000)}`,
    ...overrides,
  };
}

test('POST /api/v1/auth/register/ally responde 201 con profile ALLY/PENDING y tokens válidos', async () => {
  const res = await request(app)
    .post('/api/v1/auth/register/ally')
    .set('X-Tenant-Id', 'trama-demo')
    .send(validBody());

  assert.equal(res.status, 201);
  assert.equal(res.body.profile.role, 'ALLY');
  assert.equal(res.body.profile.status, 'PENDING');
  assert.equal(res.body.profile.tenantId, 'trama-demo');
  assert.ok(res.body.tokens.accessToken);
  assert.ok(res.body.tokens.refreshToken);

  const claims = jwt.verify(res.body.tokens.accessToken, config.supabaseJwtSecret, { algorithms: ['HS256'] });
  assert.equal(claims.tenant_id, 'trama-demo');
  assert.equal(claims.role, 'ALLY');
});

test('POST /api/v1/auth/register/ally sin X-Tenant-Id responde 400 VALIDATION_ERROR', async () => {
  const res = await request(app).post('/api/v1/auth/register/ally').send(validBody());

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/auth/register/ally con tenant inexistente responde 400 TENANT_NOT_FOUND', async () => {
  const res = await request(app)
    .post('/api/v1/auth/register/ally')
    .set('X-Tenant-Id', 'tenant-que-no-existe')
    .send(validBody());

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'TENANT_NOT_FOUND');
});

test('POST /api/v1/auth/register/ally con documentType inválido responde 400 VALIDATION_ERROR', async () => {
  const res = await request(app)
    .post('/api/v1/auth/register/ally')
    .set('X-Tenant-Id', 'trama-demo')
    .send(validBody({ documentType: 'DNI' }));

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/auth/register/ally repetido con el mismo email responde 409 EMAIL_ALREADY_REGISTERED', async () => {
  const body = validBody();

  const first = await request(app).post('/api/v1/auth/register/ally').set('X-Tenant-Id', 'trama-demo').send(body);
  assert.equal(first.status, 201);

  const second = await request(app)
    .post('/api/v1/auth/register/ally')
    .set('X-Tenant-Id', 'trama-demo')
    .send({ ...body, documentNumber: `${body.documentNumber}-otro` });

  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'EMAIL_ALREADY_REGISTERED');
});

test('POST /api/v1/auth/register/ally repetido con el mismo numero de documento responde 409 DOCUMENT_ALREADY_REGISTERED', async () => {
  const body = validBody();

  const first = await request(app).post('/api/v1/auth/register/ally').set('X-Tenant-Id', 'trama-demo').send(body);
  assert.equal(first.status, 201);

  const second = await request(app)
    .post('/api/v1/auth/register/ally')
    .set('X-Tenant-Id', 'trama-demo')
    .send({ ...body, email: `otro.${body.email}` });

  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'DOCUMENT_ALREADY_REGISTERED');
});
