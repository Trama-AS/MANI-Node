const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const config = require('../../../src/config');

function signTestToken({ sub, tenantId, role }) {
  return jwt.sign({ sub, app_metadata: { tenant_id: tenantId, user_role: role } }, config.supabaseJwtSecret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

test('GET /api/v1/tenants responde 200 con el listado de tenants', async () => {
  const res = await request(app).get('/api/v1/tenants');

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
  assert.equal(res.body.data[0].id, 'trama-demo');
});

test('GET /api/v1/profiles/me sin Authorization responde 401', async () => {
  const res = await request(app).get('/api/v1/profiles/me');

  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Encabezado Authorization requerido');
});

test('GET /api/v1/profiles/me con Authorization responde 200', async () => {
  const token = signTestToken({ sub: 'demo-user-1', tenantId: 'trama-demo', role: 'cliente' });

  const res = await request(app)
    .get('/api/v1/profiles/me')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.profile.role, 'CLIENT');
});

test('GET /api/v1/profiles/me con un token sin firma válida responde 401', async () => {
  const res = await request(app)
    .get('/api/v1/profiles/me')
    .set('Authorization', 'Bearer token-demo');

  assert.equal(res.status, 401);
  assert.equal(res.body.code, 'TOKEN_INVALID');
});

test('GET /api/v1/catalog responde 200 con categorias activas', async () => {
  const res = await request(app).get('/api/v1/catalog');

  assert.equal(res.status, 200);
  assert.ok(res.body.categories.length > 0);
});

test('GET /ruta-inexistente responde 404', async () => {
  const res = await request(app).get('/ruta-inexistente');

  assert.equal(res.status, 404);
});

// --- Gestión de categoría de servicio (US-03.1.1-M2.1) ---

function adminToken(tenantId = 'tenant-categorias-test') {
  return signTestToken({ sub: 'admin-1', tenantId, role: 'admin_tenant' });
}

test('GET /api/v1/catalog/categories sin Authorization responde 401', async () => {
  const res = await request(app).get('/api/v1/catalog/categories');

  assert.equal(res.status, 401);
});

test('GET /api/v1/catalog/categories con rol CLIENT responde 403 FORBIDDEN', async () => {
  const token = signTestToken({ sub: 'u1', tenantId: 'tenant-categorias-test', role: 'cliente' });

  const res = await request(app)
    .get('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'FORBIDDEN');
});

test('POST /api/v1/catalog/categories crea una categoría y queda aislada al tenant del token', async () => {
  const tenantId = 'tenant-categorias-crud';
  const createRes = await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken(tenantId)}`)
    .send({ name: 'Peinados', description: 'Peinados para eventos' });

  assert.equal(createRes.status, 201);
  assert.equal(createRes.body.category.tenantId, tenantId);
  assert.equal(createRes.body.category.active, true);

  const listRes = await request(app)
    .get('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken(tenantId)}`);

  assert.equal(listRes.status, 200);
  assert.ok(listRes.body.categories.some((c) => c.id === createRes.body.category.id));

  const otroTenantRes = await request(app)
    .get('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken('otro-tenant')}`);

  assert.equal(otroTenantRes.status, 200);
  assert.ok(!otroTenantRes.body.categories.some((c) => c.id === createRes.body.category.id));
});

test('POST /api/v1/catalog/categories sin name responde 400 VALIDATION_ERROR', async () => {
  const res = await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken()}`)
    .send({ description: 'sin nombre' });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
});

test('GET /api/v1/catalog/categories/:id responde 404 CATEGORY_NOT_FOUND si es de otro tenant', async () => {
  const tenantId = 'tenant-categorias-get';
  const createRes = await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken(tenantId)}`)
    .send({ name: 'Peinados' });

  const res = await request(app)
    .get(`/api/v1/catalog/categories/${createRes.body.category.id}`)
    .set('Authorization', `Bearer ${adminToken('otro-tenant')}`);

  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'CATEGORY_NOT_FOUND');
});

test('PUT /api/v1/catalog/categories/:id actualiza name/description', async () => {
  const tenantId = 'tenant-categorias-update';
  const createRes = await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken(tenantId)}`)
    .send({ name: 'Peinados' });

  const res = await request(app)
    .put(`/api/v1/catalog/categories/${createRes.body.category.id}`)
    .set('Authorization', `Bearer ${adminToken(tenantId)}`)
    .send({ name: 'Peinados de Novia' });

  assert.equal(res.status, 200);
  assert.equal(res.body.category.name, 'Peinados de Novia');
});

test('PATCH /api/v1/catalog/categories/:id/deactivate y /activate alternan el flujo operativo', async () => {
  const tenantId = 'tenant-categorias-flujo';
  const createRes = await request(app)
    .post('/api/v1/catalog/categories')
    .set('Authorization', `Bearer ${adminToken(tenantId)}`)
    .send({ name: 'Peinados' });
  const id = createRes.body.category.id;

  const deactivateRes = await request(app)
    .patch(`/api/v1/catalog/categories/${id}/deactivate`)
    .set('Authorization', `Bearer ${adminToken(tenantId)}`);
  assert.equal(deactivateRes.status, 200);
  assert.equal(deactivateRes.body.category.active, false);

  const activateRes = await request(app)
    .patch(`/api/v1/catalog/categories/${id}/activate`)
    .set('Authorization', `Bearer ${adminToken(tenantId)}`);
  assert.equal(activateRes.status, 200);
  assert.equal(activateRes.body.category.active, true);
});
