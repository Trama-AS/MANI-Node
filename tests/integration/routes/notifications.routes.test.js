const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');
const ListMyInboxUseCase = require('../../../src/application/useCases/notifications/ListMyInboxUseCase');
const MockPushProvider = require('../../../src/infrastructure/push/MockPushProvider');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '77777777-7777-4777-8777-777777777777';

function bearer({ sub = USER, role = 'aliado' } = {}) {
  const token = jwt.sign({ sub, app_metadata: { tenant_id: TENANT, user_role: role } }, config.supabaseJwtSecret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
  return `Bearer ${token}`;
}

test('GET /profiles/me/inbox devuelve la bandeja del usuario del token, marcada como simulada', async () => {
  const calls = [];
  const original = container.listMyInboxUseCase;
  container.listMyInboxUseCase = new ListMyInboxUseCase({
    notificacionRepository: {
      listForUser: async (...args) => {
        calls.push(args);
        return [{ id: 'n1', tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload: {}, enviadoAt: new Date('2026-10-25T10:00:00Z'), leidoAt: null }];
      },
    },
    pushProvider: new MockPushProvider(),
  });
  try {
    const res = await request(app).get('/api/v1/profiles/me/inbox?limit=5').set('Authorization', bearer());

    assert.equal(res.status, 200);
    assert.equal(res.body.simulada, true);
    assert.equal(res.body.items[0].id, 'n1');
    assert.deepEqual(calls[0], [TENANT, USER, { limit: 5 }]);
  } finally {
    container.listMyInboxUseCase = original;
  }
});

test('GET /profiles/me/inbox sin Authorization responde 401', async () => {
  const res = await request(app).get('/api/v1/profiles/me/inbox');
  assert.equal(res.status, 401);
});

test('GET /profiles/me/inbox sin DATABASE_URL responde 503 en lugar de inventar datos', async () => {
  const res = await request(app).get('/api/v1/profiles/me/inbox').set('Authorization', bearer());
  assert.equal(res.status, 503);
});
