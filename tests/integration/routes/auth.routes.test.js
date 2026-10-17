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
    .set('X-Tenant-Slug', overrides.tenantSlug ?? 'trama-demo')
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

test('POST /api/v1/auth/register/ally con slug real plomeria-express resuelve tenant_id uuid', async () => {
  const res = await registerRequest({ tenantSlug: 'plomeria-express' });

  assert.equal(res.status, 201);
  assert.equal(res.body.profile.role, 'ALLY');
  assert.equal(res.body.profile.tenantId, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');

  const claims = jwt.verify(res.body.tokens.accessToken, config.supabaseJwtSecret, { algorithms: ['HS256'] });
  assert.equal(claims.app_metadata.tenant_id, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
});

test('POST /api/v1/auth/register/ally sin X-Tenant-Slug responde 400 VALIDATION_ERROR', async () => {
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

test('POST /api/v1/auth/register/ally con solo X-Tenant-Id (sin X-Tenant-Slug) responde 400 VALIDATION_ERROR', async () => {
  const res = await request(app)
    .post('/api/v1/auth/register/ally')
    .set('X-Tenant-Id', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
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
  const res = await registerRequest({ tenantSlug: 'tenant-que-no-existe' });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'TENANT_NOT_FOUND');
});

test('POST /api/v1/auth/register/ally con categoriaId inexistente responde 400 CATEGORY_NOT_FOUND', async () => {
  const res = await registerRequest({ categoriaId: 'cat-no-existe' });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'CATEGORY_NOT_FOUND');
});

test('POST /api/v1/auth/register/ally con un campo de archivo fuera del whitelist responde 400 VALIDATION_ERROR', async () => {
  const unique = `${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const res = await request(app)
    .post('/api/v1/auth/register/ally')
    .set('X-Tenant-Slug', 'trama-demo')
    .field('fullName', 'Campo No Permitido')
    .field('email', `aliado.${unique}@mani.test`)
    .field('password', 'Cambiar123!')
    .field('categoriaId', 'cat-1')
    .attach('lo_que_sea', Buffer.from('contenido'), 'archivo.pdf');

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/auth/register/ally con un MIME no permitido responde 400 VALIDATION_ERROR', async () => {
  const unique = `${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const res = await request(app)
    .post('/api/v1/auth/register/ally')
    .set('X-Tenant-Slug', 'trama-demo')
    .field('fullName', 'MIME No Permitido')
    .field('email', `aliado.${unique}@mani.test`)
    .field('password', 'Cambiar123!')
    .field('categoriaId', 'cat-1')
    .attach('cedula_ciudadania', Buffer.from('<html></html>'), { filename: 'cedula.html', contentType: 'text/html' });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/auth/register/ally repetido con el mismo email responde 409 EMAIL_ALREADY_REGISTERED', async () => {
  const email = `aliado.dup.${Date.now()}@mani.test`;

  const first = await registerRequest({ email });
  assert.equal(first.status, 201);

  const second = await registerRequest({ email });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'EMAIL_ALREADY_REGISTERED');
});

function registerCompanyRequest(overrides = {}) {
  const unique = `${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const endpoint = overrides.endpoint ?? '/api/v1/core/aliados/empresa';
  const req = request(app)
    .post(endpoint)
    .set('X-Tenant-Slug', overrides.tenantSlug ?? 'trama-demo')
    .field('razon_social', overrides.razonSocial ?? 'Servicios Integrales SAS')
    .field('nit', overrides.nit ?? `900.${unique}`)
    .field('nombre_representante', overrides.nombreRepresentante ?? 'Andres Felipe Perez')
    .field('email', overrides.email ?? `empresa.${unique}@mani.test`)
    .field('password', overrides.password ?? 'Cambiar123!')
    .field('categoria_id', overrides.categoriaId ?? 'cat-1');

  if (overrides.attachCamara !== false) {
    req.attach('camara_comercio', Buffer.from('contenido-fake-camara'), 'camara.pdf');
  }

  return req;
}

test('POST /api/v1/core/aliados/empresa responde 201 con estado_verificacion PENDIENTE y profile ALLY/PENDING', async () => {
  const res = await registerCompanyRequest();

  assert.equal(res.status, 201);
  assert.equal(res.body.estado_verificacion, 'PENDIENTE');
  assert.ok(res.body.usuario_id);
  assert.ok(res.body.aliado_id);
  assert.equal(res.body.profile.role, 'ALLY');
  assert.equal(res.body.profile.status, 'PENDING');
  assert.equal(res.body.profile.tenantId, 'trama-demo');
});

test('POST /api/v1/auth/register/ally/company sin camara_comercio responde 400 VALIDATION_ERROR', async () => {
  const res = await registerCompanyRequest({
    endpoint: '/api/v1/auth/register/ally/company',
    attachCamara: false,
  });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/core/aliados/empresa con NIT duplicado en el mismo tenant responde 409 COMPANY_ALREADY_REGISTERED', async () => {
  const nit = `901.555.${Date.now()}`;

  const first = await registerCompanyRequest({ nit });
  assert.equal(first.status, 201);

  const second = await registerCompanyRequest({ nit });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'COMPANY_ALREADY_REGISTERED');
});

