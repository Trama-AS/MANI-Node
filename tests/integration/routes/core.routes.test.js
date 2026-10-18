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

test('GET /api/v1/profiles/me/categories sin Authorization responde 401', async () => {
  const res = await request(app).get('/api/v1/profiles/me/categories');

  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Encabezado Authorization requerido');
});

test('GET /api/v1/profiles/me/categories con rol CLIENT responde 403 (MANI-CAT-403)', async () => {
  const token = signTestToken({ sub: 'demo-user-1', tenantId: 'trama-demo', role: 'cliente' });

  const res = await request(app)
    .get('/api/v1/profiles/me/categories')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'MANI-CAT-403');
});

test('GET /api/v1/profiles/me/categories con rol ALLY responde 200 y retorna sus categorías', async () => {
  const token = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });

  const res = await request(app)
    .get('/api/v1/profiles/me/categories')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.categories));
  assert.ok(res.body.categories.includes('cat-1'));
});

test('GET /api/v1/profiles/me/categories/available sin Authorization responde 401', async () => {
  const res = await request(app).get('/api/v1/profiles/me/categories/available');

  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Encabezado Authorization requerido');
});

test('GET /api/v1/profiles/me/categories/available con rol CLIENT responde 403 (MANI-CAT-403)', async () => {
  const token = signTestToken({ sub: 'demo-user-1', tenantId: 'trama-demo', role: 'cliente' });

  const res = await request(app)
    .get('/api/v1/profiles/me/categories/available')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'MANI-CAT-403');
});

test('GET /api/v1/profiles/me/categories/available con rol ALLY lista solo categorías activas, ordenadas, con id y name', async () => {
  const token = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });

  const res = await request(app)
    .get('/api/v1/profiles/me/categories/available')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 200);
  const ids = res.body.categories.map((c) => c.id);
  assert.ok(ids.includes('cat-1'));
  assert.ok(!ids.includes('cat-inactive'), 'una categoría inactiva no debe ofrecerse');
  for (const c of res.body.categories) assert.deepEqual(Object.keys(c).sort(), ['id', 'name']);
  const names = res.body.categories.map((c) => c.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'es')));
});

test('PUT /api/v1/profiles/me/categories con lista vacía responde 422 (MANI-CAT-422V)', async () => {
  const token = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });

  const res = await request(app)
    .put('/api/v1/profiles/me/categories')
    .set('Authorization', `Bearer ${token}`)
    .send({ categories: [] });

  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'MANI-CAT-422V');
});

test('PUT /api/v1/profiles/me/categories con categoría inexistente responde 422 (MANI-CAT-422C)', async () => {
  const token = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });

  const res = await request(app)
    .put('/api/v1/profiles/me/categories')
    .set('Authorization', `Bearer ${token}`)
    .send({ categories: ['cat-1', 'cat-inexistente'] });

  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'MANI-CAT-422C');
});

test('PUT /api/v1/profiles/me/categories con categoría inactiva responde 422 (MANI-CAT-422C)', async () => {
  const token = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });

  const res = await request(app)
    .put('/api/v1/profiles/me/categories')
    .set('Authorization', `Bearer ${token}`)
    .send({ categories: ['cat-inactive'] });

  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'MANI-CAT-422C');
});

test('PUT /api/v1/profiles/me/categories con categorías válidas actualiza exitosamente', async () => {
  const token = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });

  const res = await request(app)
    .put('/api/v1/profiles/me/categories')
    .set('Authorization', `Bearer ${token}`)
    .send({ categories: ['cat-1', 'cat-2'] });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.categories, ['cat-1', 'cat-2']);

  // Verifica que GET posterior retorne las nuevas categorías
  const getRes = await request(app)
    .get('/api/v1/profiles/me/categories')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(getRes.status, 200);
  assert.deepEqual(getRes.body.categories, ['cat-1', 'cat-2']);
});

test('POST /profiles/me/categories (alias y ruta raíz) responde 200', async () => {
  const token = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });

  const res = await request(app)
    .post('/profiles/me/categories')
    .set('Authorization', `Bearer ${token}`)
    .send({ categoriaIds: ['cat-2', 'cat-3'] });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body.categories, ['cat-2', 'cat-3']);
});
