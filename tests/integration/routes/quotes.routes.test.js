process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const config = require('../../../src/config');

function signTestToken({ sub, tenantId, role, secret = config.supabaseJwtSecret, expiresIn = '1h' }) {
  return jwt.sign({ sub, app_metadata: { tenant_id: tenantId, user_role: role } }, secret, { algorithm: 'HS256', expiresIn });
}

const ruta = '/api/v1/solicitudes/sol-demo-1/cotizaciones';
const allyToken = () => signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });

test('POST cotización sin Authorization responde 401', async () => {
  const res = await request(app).post(ruta).send({ valorManoObra: 50000 });

  assert.equal(res.status, 401);
});

test('POST cotización con token expirado o firmado con otro secreto responde 401', async () => {
  const expirado = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado', expiresIn: -60 });
  const ajeno = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado', secret: 'otro-secreto' });

  for (const token of [expirado, ajeno]) {
    const res = await request(app).post(ruta).set('Authorization', `Bearer ${token}`).send({ valorManoObra: 50000 });
    assert.equal(res.status, 401);
  }
});

test('POST cotización con rol cliente responde 403', async () => {
  const token = signTestToken({ sub: 'demo-user-1', tenantId: 'trama-demo', role: 'cliente' });
  const res = await request(app).post(ruta).set('Authorization', `Bearer ${token}`).send({ valorManoObra: 50000 });

  assert.equal(res.status, 403);
});

test('POST cotización con valores negativos responde 400 VALIDATION_ERROR', async () => {
  const res = await request(app).post(ruta).set('Authorization', `Bearer ${allyToken()}`).send({ valorManoObra: -1000 });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'VALIDATION_ERROR');
});

test('POST cotización con un total que no cuadra responde 400', async () => {
  const res = await request(app)
    .post(ruta)
    .set('Authorization', `Bearer ${allyToken()}`)
    .send({ valorManoObra: 50000, valorMateriales: 20000, valor: 80000 });

  assert.equal(res.status, 400);
});

test('cross-tenant: un aliado de otro tenant no ve la solicitud (no hay perfil de aliado allí: 403) ni cotiza', async () => {
  const token = signTestToken({ sub: 'demo-ally-1', tenantId: 'otro-tenant', role: 'aliado' });
  const res = await request(app).post(ruta).set('Authorization', `Bearer ${token}`).send({ valorManoObra: 50000 });

  assert.ok([403, 404].includes(res.status));
});

test('POST cotización del aliado asignado responde 201 con aliado.id, total derivado y tarifario PENDIENTE', async () => {
  const res = await request(app)
    .post(ruta)
    .set('Authorization', `Bearer ${allyToken()}`)
    .send({ valorManoObra: 65000, valorMateriales: 15000, observacion: 'Incluye repuestos originales' });

  assert.equal(res.status, 201);
  assert.ok(res.body.cotizacion.id);
  assert.equal(res.body.cotizacion.solicitudId, 'sol-demo-1');
  assert.equal(res.body.cotizacion.aliadoId, 'demo-aliado-1');
  assert.equal(res.body.cotizacion.valor, 80000);
  assert.equal(res.body.cotizacion.estado, 'PENDIENTE');
  assert.equal(res.body.validacionTarifario, 'PENDIENTE');
});

test('POST /api/v1/cotizaciones (alias retirado) ya no existe', async () => {
  const res = await request(app).post('/api/v1/cotizaciones').set('Authorization', `Bearer ${allyToken()}`).send({ solicitudId: 'sol-demo-1', valorManoObra: 1 });

  assert.equal(res.status, 404);
});
