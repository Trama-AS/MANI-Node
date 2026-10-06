const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../../../src/app');

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
  const res = await request(app)
    .get('/api/v1/profiles/me')
    .set('Authorization', 'Bearer token-demo');

  assert.equal(res.status, 200);
  assert.equal(res.body.profile.role, 'CLIENT');
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
