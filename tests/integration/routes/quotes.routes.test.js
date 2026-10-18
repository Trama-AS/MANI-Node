const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const config = require('../../../src/config');

function signTestToken({ sub, tenantId, role }) {
  return jwt.sign(
    { sub, app_metadata: { tenant_id: tenantId, user_role: role } },
    config.supabaseJwtSecret,
    { algorithm: 'HS256', expiresIn: '1h' }
  );
}

test('POST /api/v1/cotizaciones sin Authorization responde 401', async () => {
  const res = await request(app)
    .post('/api/v1/cotizaciones')
    .send({ solicitudId: 'sol-demo-1', valorManoObra: 50000 });

  assert.equal(res.status, 401);
});

test('POST /api/v1/cotizaciones con rol CLIENT responde 403', async () => {
  const token = signTestToken({ sub: 'demo-client-1', tenantId: 'trama-demo', role: 'cliente' });
  const res = await request(app)
    .post('/api/v1/cotizaciones')
    .set('Authorization', `Bearer ${token}`)
    .send({ solicitudId: 'sol-demo-1', valorManoObra: 50000 });

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'FORBIDDEN');
});

test('POST /api/v1/cotizaciones con valores negativos responde 400 VALIDATION_ERROR', async () => {
  const token = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });
  const res = await request(app)
    .post('/api/v1/cotizaciones')
    .set('Authorization', `Bearer ${token}`)
    .send({ solicitudId: 'sol-demo-1', valorManoObra: -1000 });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
  assert.ok(res.body.error.includes('no puede ser negativo'));
});

test('POST /api/v1/cotizaciones con suma discordante de total responde 400 VALIDATION_ERROR', async () => {
  const token = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });
  const res = await request(app)
    .post('/api/v1/cotizaciones')
    .set('Authorization', `Bearer ${token}`)
    .send({
      solicitudId: 'sol-demo-1',
      valorManoObra: 50000,
      valorMateriales: 20000,
      valor: 80000,
    });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
});

test('POST /api/v1/solicitudes/:solicitudId/cotizaciones emite cotización exitosa con 201 Created', async () => {
  const token = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });
  const res = await request(app)
    .post('/api/v1/solicitudes/sol-demo-1/cotizaciones')
    .set('Authorization', `Bearer ${token}`)
    .send({
      valorManoObra: 65000,
      valorMateriales: 15000,
      observacion: 'Incluye repuestos originales',
    });

  assert.equal(res.status, 201);
  assert.ok(res.body.cotizacion.id);
  assert.equal(res.body.cotizacion.solicitudId, 'sol-demo-1');
  assert.equal(res.body.cotizacion.valorManoObra, 65000);
  assert.equal(res.body.cotizacion.valorMateriales, 15000);
  assert.equal(res.body.cotizacion.valor, 80000);
  assert.equal(res.body.cotizacion.estado, 'PENDIENTE');
  assert.equal(res.body.fueraDeRango, false);
});

test('POST /api/v1/cotizaciones emite cotización fuera de rango con 201 Created y alerta (RF-16)', async () => {
  const token = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });
  const res = await request(app)
    .post('/api/v1/cotizaciones')
    .set('Authorization', `Bearer ${token}`)
    .send({
      solicitudId: 'sol-demo-1',
      valorManoObra: 1500000,
      valorMateriales: 500000,
    });

  assert.equal(res.status, 201);
  assert.equal(res.body.cotizacion.valor, 2000000);
  assert.equal(res.body.fueraDeRango, true);
  assert.ok(res.body.alerta.includes('excede el tarifario'));
});
