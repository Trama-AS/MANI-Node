const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');
const LegalDocument = require('../../../src/domain/entities/LegalDocument');

function signValidToken({ userId = 'user-consent-123', tenantId = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', role = 'aliado', expiresIn = '1h' } = {}) {
  return jwt.sign(
    {
      sub: userId,
      app_metadata: {
        tenant_id: tenantId,
        user_role: role,
      },
    },
    config.supabaseJwtSecret,
    { algorithm: 'HS256', expiresIn }
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

test('GET /api/v1/legal/documents/active con X-Tenant-Slug del tenant A no devuelve documentos propios del tenant B (Políticas §13.4)', async () => {
  // Crear documento propio del tenant B (electricistas-pro: a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22)
  const docTenantB = new LegalDocument({
    id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380b99',
    tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
    tipo: 'TERMS_AND_CONDITIONS',
    version: '2.0',
    contenido: 'Términos privados de Electricistas Pro',
    isActive: true,
  });
  await container.legalDocumentRepository.create(docTenantB);

  // Consultar activo para tenant A (plomeria-express: a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11)
  const res = await request(app)
    .get('/api/v1/legal/documents/active')
    .set('X-Tenant-Slug', 'plomeria-express');

  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.data));
  // No debe contener el documento privado de tenant B
  assert.equal(res.body.data.some((d) => d.id === 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380b99'), false);
});

test('POST /api/v1/legal/consents sin Authorization retorna 401', async () => {
  const res = await request(app)
    .post('/api/v1/legal/consents')
    .send({ documentoLegalIds: [] });

  assert.equal(res.status, 401);
});

test('POST /api/v1/legal/consents con token expirado retorna 401 Unauthorized (Políticas §13.4)', async () => {
  const expiredToken = signValidToken({ expiresIn: -60 });

  const res = await request(app)
    .post('/api/v1/legal/consents')
    .set('Authorization', `Bearer ${expiredToken}`)
    .send({ documentoLegalIds: [] });

  assert.equal(res.status, 401);
});

test('POST /api/v1/legal/consents con un documentoLegalIds inexistente responde 404 Not Found', async () => {
  const token = signValidToken({ userId: 'user-auth-test-404' });

  const res = await request(app)
    .post('/api/v1/legal/consents')
    .set('Authorization', `Bearer ${token}`)
    .send({ documentoLegalIds: ['documento-inexistente-uuid-999'] });

  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'LEGAL_DOCUMENT_NOT_FOUND');
});

test('POST /api/v1/legal/consents con un documentoLegalIds de otro tenant responde 404 Not Found (Políticas §13.4)', async () => {
  // Token de Tenant A (plomeria-express: a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11)
  const tokenTenantA = signValidToken({
    userId: 'user-tenant-a',
    tenantId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
  });

  // Intentar consentir documento privado de Tenant B
  const res = await request(app)
    .post('/api/v1/legal/consents')
    .set('Authorization', `Bearer ${tokenTenantA}`)
    .send({ documentoLegalIds: ['b0eebc99-9c0b-4ef8-bb6d-6bb9bd380b99'] });

  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'LEGAL_DOCUMENT_NOT_FOUND');
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
