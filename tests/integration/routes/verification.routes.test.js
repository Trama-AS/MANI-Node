process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const config = require('../../../src/config');

function signToken({ sub = 'admin-1', tenantId = 'trama-demo', role = 'admin_tenant' } = {}) {
  return jwt.sign(
    {
      sub,
      role: 'authenticated',
      app_metadata: {
        tenant_id: tenantId,
        user_role: role,
      },
    },
    config.supabaseJwtSecret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

async function registerAllyOnTenant(tenantSlug = 'trama-demo') {
  const unique = `${Date.now()}.${Math.random().toString(36).slice(2)}`;
  const res = await request(app)
    .post('/api/v1/auth/register/ally')
    .set('X-Tenant-Slug', tenantSlug)
    .field('fullName', `Candidato ${unique}`)
    .field('email', `candidato.${unique}@mani.test`)
    .field('password', 'Cambiar123!')
    .field('categoriaId', 'cat-1')
    .attach('cedula_ciudadania', Buffer.from('pdf-content'), 'cedula.pdf');

  assert.equal(res.status, 201);
  return res.body.profile.id;
}

test('GET /api/v1/aliados/verificacion sin token responde 401 (CC-3)', async () => {
  const res = await request(app).get('/api/v1/aliados/verificacion');
  assert.equal(res.status, 401);
});

test('GET /api/v1/aliados/verificacion con rol aliado o cliente responde 403 MANI-VER-403 (CA-6)', async () => {
  const allyToken = signToken({ sub: 'ally-1', tenantId: 'trama-demo', role: 'aliado' });
  const res = await request(app)
    .get('/api/v1/aliados/verificacion')
    .set('Authorization', `Bearer ${allyToken}`);

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'MANI-VER-403');
});

test('Flujo completo HTTP US-02.1.3-M2: bandeja del tenant, URL firmada KYC, aprobar, rechazar y aislamiento cross-tenant (CA-1..CA-7)', async () => {
  const userIdAprobado = await registerAllyOnTenant('trama-demo');
  const userIdRechazado = await registerAllyOnTenant('trama-demo');
  const userIdOtroTenant = await registerAllyOnTenant('plomeria-express');

  const adminDemoToken = signToken({ sub: 'admin-demo', tenantId: 'trama-demo', role: 'admin_tenant' });

  // CA-1: Bandeja lista los aliados de trama-demo y nunca los de plomeria-express
  const listRes = await request(app)
    .get('/api/v1/aliados/verificacion')
    .set('Authorization', `Bearer ${adminDemoToken}`)
    .set('X-Tenant-Id', 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'); // CC-2: debe ignorarse el header del cliente

  assert.equal(listRes.status, 200);
  const ids = listRes.body.map((a) => a.id);
  assert.ok(ids.includes(`aliado-${userIdAprobado}`));
  assert.ok(ids.includes(`aliado-${userIdRechazado}`));
  assert.ok(!ids.includes(`aliado-${userIdOtroTenant}`));

  // CA-2: Detalle con documentos KYC y URL firmada temporal
  const detailRes = await request(app)
    .get(`/api/v1/aliados/aliado-${userIdAprobado}/verificacion`)
    .set('Authorization', `Bearer ${adminDemoToken}`);

  assert.equal(detailRes.status, 200);
  assert.equal(detailRes.body.estado_verificacion, 'PENDIENTE');
  assert.equal(detailRes.body.documentos.length, 1);

  const docId = detailRes.body.documentos[0].id;
  const signedRes = await request(app)
    .get(`/api/v1/aliados/aliado-${userIdAprobado}/documentos/${docId}/url`)
    .set('Authorization', `Bearer ${adminDemoToken}`);

  assert.equal(signedRes.status, 200);
  assert.match(signedRes.body.signedUrl, /token=/);

  // CA-3: Aprobar aliado pendiente
  const approveRes = await request(app)
    .patch(`/api/v1/aliados/aliado-${userIdAprobado}/verificacion`)
    .set('Authorization', `Bearer ${adminDemoToken}`)
    .set('X-Correlation-ID', 'corr-approve-1')
    .send({ decision: 'VERIFICADO' });

  assert.equal(approveRes.status, 200);
  assert.equal(approveRes.body.estado_verificacion, 'VERIFICADO');

  // CA-4: Rechazar aliado pendiente con motivo obligatorio
  const rejectRes = await request(app)
    .patch(`/api/v1/aliados/aliado-${userIdRechazado}/verificacion`)
    .set('Authorization', `Bearer ${adminDemoToken}`)
    .send({
      decision: 'RECHAZADO',
      motivo: 'Documento ilegible, por favor adjunta una copia clara.',
    });

  assert.equal(rejectRes.status, 200);
  assert.equal(rejectRes.body.estado_verificacion, 'RECHAZADO');
  assert.equal(rejectRes.body.motivo_rechazo, 'Documento ilegible, por favor adjunta una copia clara.');

  // CA-7: Rechazo cross-tenant (KI-05) al intentar aprobar aliado de otro tenant
  const crossTenantRes = await request(app)
    .patch(`/api/v1/aliados/aliado-${userIdOtroTenant}/verificacion`)
    .set('Authorization', `Bearer ${adminDemoToken}`)
    .send({ decision: 'VERIFICADO' });

  assert.equal(crossTenantRes.status, 404);
  assert.equal(crossTenantRes.body.code, 'MANI-VER-404');
});
