const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
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
    .field('categoriaId', overrides.categoriaId ?? 'cat-1')
    .field('acceptsTerms', overrides.acceptsTerms ?? 'true');

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

test('POST /api/v1/auth/register/ally sin acceptsTerms responde 400 TERMS_NOT_ACCEPTED (DoD §9.3)', async () => {
  const res = await registerRequest({ acceptsTerms: 'false' });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'TERMS_NOT_ACCEPTED');
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
  const endpoint = overrides.endpoint ?? '/api/v1/auth/register/ally/company';
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

test('POST /api/v1/auth/register/ally/company responde 201 con estado_verificacion PENDIENTE y profile ALLY/PENDING', async () => {
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
    attachCamara: false,
  });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/auth/register/ally/company con NIT duplicado en el mismo tenant responde 409 COMPANY_ALREADY_REGISTERED', async () => {
  const nit = `901.555.${Date.now()}`;

  const first = await registerCompanyRequest({ nit });
  assert.equal(first.status, 201);

  const second = await registerCompanyRequest({ nit });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'COMPANY_ALREADY_REGISTERED');
});

test('CA-5: usuario del tenant B no puede consultar datos ni documentos de aliado empresa del tenant A (Políticas §13.4)', async () => {
  const container = require('../../../src/container');
  const nit = `901.777.${Date.now()}`;

  // 1. Registrar empresa en tenant A (plomeria-express: a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11)
  const regRes = await registerCompanyRequest({
    tenantSlug: 'plomeria-express',
    nit,
  });
  assert.equal(regRes.status, 201);
  const allyUserId = regRes.body.usuario_id;
  const tenantAId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11';
  const tenantBId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22';

  // 2. Control positivo: el aliado sí es visible bajo su propio tenant (tenant A)
  const allyInTenantA = await container.aliadoRepository.findByUsuarioId(tenantAId, allyUserId);
  assert.notEqual(allyInTenantA, null);

  // 3. Verificar que el repositorio de aliados acotado a tenant B no encuentra al aliado de tenant A
  const allyInTenantB = await container.aliadoRepository.findByUsuarioId(tenantBId, allyUserId);
  assert.equal(allyInTenantB, null);

  // 4. Verificar que los documentos KYC del aliado de tenant A no sean accesibles bajo tenant B
  const docsInTenantB = (container.documentoKycRepository.rows || [])
    .filter((r) => r.tenantId === tenantBId && r.aliadoId === regRes.body.aliado_id);
  assert.deepEqual(docsInTenantB, []);
});

// --- Registro de Cliente persona natural (US-02.2.1-M2) ---
// Mismo endpoint de identidad y mismo cliente HTTP (supertest contra la app
// real) que el registro de Aliado; aquí es JSON puro, sin multer/archivos.

function registerClientRequest(overrides = {}) {
  const unique = `${Date.now()}.${Math.random().toString(36).slice(2)}`;
  return request(app)
    .post('/api/v1/auth/register/client')
    .set('X-Tenant-Slug', overrides.tenantSlug ?? 'trama-demo')
    .send({
      fullName: overrides.fullName ?? 'Carlos Andres Gomez',
      email: overrides.email ?? `cliente.${unique}@mani.test`,
      password: overrides.password ?? 'Cambiar123!',
      ...(overrides.phone !== undefined ? { phone: overrides.phone } : {}),
      ...(overrides.direccionHogar !== undefined ? { direccionHogar: overrides.direccionHogar } : {}),
    });
}

test('POST /api/v1/auth/register/client responde 201 con profile CLIENT/VERIFIED y tokens válidos (CA-1)', async () => {
  const res = await registerClientRequest();

  assert.equal(res.status, 201);
  assert.equal(res.body.profile.role, 'CLIENT');
  assert.equal(res.body.profile.status, 'VERIFIED');
  assert.equal(res.body.profile.tenantId, 'trama-demo');
  assert.ok(res.body.tokens.accessToken);
  assert.ok(res.body.tokens.refreshToken);

  const claims = jwt.verify(res.body.tokens.accessToken, config.supabaseJwtSecret, { algorithms: ['HS256'] });
  assert.equal(claims.app_metadata.tenant_id, 'trama-demo');
  assert.equal(claims.app_metadata.user_role, 'cliente');
});

test('POST /api/v1/auth/register/client con slug real plomeria-express resuelve tenant_id uuid (CA-5)', async () => {
  const res = await registerClientRequest({ tenantSlug: 'plomeria-express' });

  assert.equal(res.status, 201);
  assert.equal(res.body.profile.tenantId, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');

  const claims = jwt.verify(res.body.tokens.accessToken, config.supabaseJwtSecret, { algorithms: ['HS256'] });
  assert.equal(claims.app_metadata.tenant_id, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
});

test('POST /api/v1/auth/register/client sin X-Tenant-Slug responde 400 VALIDATION_ERROR', async () => {
  const res = await request(app).post('/api/v1/auth/register/client').send({
    fullName: 'x',
    email: 'x@mani.test',
    password: 'Cambiar123!',
  });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/auth/register/client con tenant inexistente responde 400 TENANT_NOT_FOUND', async () => {
  const res = await registerClientRequest({ tenantSlug: 'tenant-que-no-existe' });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'TENANT_NOT_FOUND');
});

test('POST /api/v1/auth/register/client repetido con el mismo email responde 409 EMAIL_ALREADY_REGISTERED (CA-4)', async () => {
  const email = `cliente.dup.${Date.now()}@mani.test`;

  const first = await registerClientRequest({ email });
  assert.equal(first.status, 201);

  const second = await registerClientRequest({ email });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'EMAIL_ALREADY_REGISTERED');
});

test('POST /api/v1/auth/register/client permite el mismo email en tenants distintos (aislamiento cross-tenant)', async () => {
  const email = `cliente.crosstenant.${Date.now()}@mani.test`;

  const res1 = await registerClientRequest({ tenantSlug: 'trama-demo', email });
  assert.equal(res1.status, 201);
  assert.equal(res1.body.profile.tenantId, 'trama-demo');

  const res2 = await registerClientRequest({ tenantSlug: 'plomeria-express', email });
  assert.equal(res2.status, 201);
  assert.equal(res2.body.profile.tenantId, 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11');
});

test('POST /api/v1/auth/register/client con direccionHogar responde 201 (CA-1: guarda el sitio/hogar inicial)', async () => {
  const res = await registerClientRequest({ direccionHogar: 'Calle 123 # 45-67' });

  assert.equal(res.status, 201);
  assert.equal(res.body.profile.role, 'CLIENT');
  assert.equal(res.body.profile.status, 'VERIFIED');
});

test('POST /api/v1/auth/register/client no acepta archivos (no hay multer montado en esta ruta)', async () => {
  const unique = `${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const res = await request(app)
    .post('/api/v1/auth/register/client')
    .set('X-Tenant-Slug', 'trama-demo')
    .field('fullName', 'Sin Archivos')
    .field('email', `cliente.${unique}@mani.test`)
    .field('password', 'Cambiar123!');

  // Sin express.json() parseando multipart, req.body queda vacío -> VALIDATION_ERROR.
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
});

// ---- HU-M02-07 (SCRUM-1375): registro de cliente empresa ----

function registerClientCompanyRequest(overrides = {}) {
  const unique = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  return request(app)
    .post('/api/v1/auth/register/client/company')
    .set('X-Tenant-Slug', overrides.tenantSlug ?? 'trama-demo')
    .send({
      razonSocial: overrides.razonSocial ?? 'Constructora Andina SAS',
      nit: overrides.nit ?? `9${unique.slice(-8)}-1`,
      nombreRepresentante: overrides.nombreRepresentante ?? 'Laura Gomez',
      email: overrides.email ?? `empresa.${unique}@mani.test`,
      password: overrides.password ?? 'Cambiar123!',
      acceptsTerms: overrides.acceptsTerms ?? true,
    });
}

test('POST /api/v1/auth/register/client/company responde 201 con cliente CLIENT, la empresa y tokens válidos', async () => {
  const res = await registerClientCompanyRequest();

  assert.equal(res.status, 201);
  assert.equal(res.body.profile.role, 'CLIENT');
  assert.equal(res.body.profile.fullName, 'Constructora Andina SAS');
  assert.equal(res.body.company.tipo, 'PERSONA_JURIDICA');
  assert.equal(res.body.company.nombreRepresentante, 'Laura Gomez');
  const claims = jwt.verify(res.body.tokens.accessToken, config.supabaseJwtSecret, { algorithms: ['HS256'] });
  assert.equal(claims.app_metadata.user_role, 'cliente');
});

test('POST /api/v1/auth/register/client/company con el mismo NIT responde 409 COMPANY_ALREADY_REGISTERED', async () => {
  const nit = `8${String(Date.now()).slice(-8)}-3`;
  assert.equal((await registerClientCompanyRequest({ nit })).status, 201);

  const second = await registerClientCompanyRequest({ nit });
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'COMPANY_ALREADY_REGISTERED');
});

test('POST /api/v1/auth/register/client/company: el mismo NIT en otro tenant se registra (201) y en el mismo tenant da 409', async () => {
  const nit = `7${String(Date.now()).slice(-8)}-5`;

  const enA = await registerClientCompanyRequest({ nit, tenantSlug: 'trama-demo' });
  assert.equal(enA.status, 201);

  const enB = await registerClientCompanyRequest({ nit, tenantSlug: 'plomeria-express' });
  assert.equal(enB.status, 201, 'el NIT de otro tenant no cuenta como duplicado');
  assert.notEqual(enA.body.profile.tenantId, enB.body.profile.tenantId);

  const repetidoEnA = await registerClientCompanyRequest({ nit, tenantSlug: 'trama-demo' });
  assert.equal(repetidoEnA.status, 409);
  assert.equal(repetidoEnA.body.code, 'COMPANY_ALREADY_REGISTERED');
});

test('POST /api/v1/auth/register/client/company sin aceptar términos responde 400 TERMS_NOT_ACCEPTED', async () => {
  const res = await registerClientCompanyRequest({ acceptsTerms: false });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'TERMS_NOT_ACCEPTED');
});

test('POST /api/v1/auth/register/client/company con NIT inválido responde 400 VALIDATION_ERROR', async () => {
  const res = await registerClientCompanyRequest({ nit: 'ABC' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
});

