const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const app = require('../../../src/app');

test('GET /health responde 200 con status UP cuando Supabase no está configurado (DEV)', async () => {
  const res = await request(app).get('/health');

  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'UP');
  assert.equal(res.body.service, 'MANI-Core-Node');
  assert.ok(typeof res.body.environment === 'string');
  assert.ok(typeof res.body.uptimeSeconds === 'number');
  assert.equal(res.body.database.configured, false);
  assert.equal(res.body.database.connected, false);
});
