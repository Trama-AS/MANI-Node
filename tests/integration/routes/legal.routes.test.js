const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const config = require('../../../src/config');

function signValidToken({ userId = 'user-consent-123', tenantId = 'trama-demo', role = 'aliado' } = {}) {
  return jwt.sign(
    {
      sub: userId,
      app_metadata: {
        tenant_id: tenantId,
        user_role: role,
      },
    },
    config.supabaseJwtSecret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

test('GET /api/v1/legal/documents/active retorna lista de documentos legales activos (default)', async () => {
  const res = await request(app)
    .get('/api/v1/legal/documents/active')
    .set('X-Tenant-Slug', 'trama-demo');

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
  assert.ok(res.body.data.length >= 2);
  assert.equal(res.body.data[0].tipo, 'TERMS_AND_CONDITIONS');
  assert.equal(res.body.data[1].tipo, 'PRIVACY_POLICY');
});

test('POST /api/v1/legal/consents sin Authorization retorna 401', async () => {
  const res = await request(app)
    .post('/api/v1/legal/consents')
    .send({ documentoLegalIds: [] });

  assert.equal(res.status, 401);
});

test('POST /api/v1/legal/consents con token válido registra consentimiento y responde 201', async () => {
  const token = signValidToken({ userId: 'user-auth-test-1' });

  const res = await request(app)
    .post('/api/v1/legal/consents')
    .set('Authorization', `Bearer ${token}`)
    .send({ documentoLegalIds: [] });

  assert.equal(res.status, 201);
  assert.equal(res.body.message, 'Consentimientos registrados con éxito');
  assert.ok(Array.isArray(res.body.consents));
  assert.ok(res.body.consents.length >= 2);
  assert.equal(res.body.consents[0].usuarioId, 'user-auth-test-1');
});
