const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const app = require('../../../src/app');
const config = require('../../../src/config');

function signTestToken({ sub, tenantId, role }) {
  return jwt.sign({ sub, app_metadata: { tenant_id: tenantId, user_role: role } }, config.supabaseJwtSecret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

const allyToken = () => signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });
const clientToken = () => signTestToken({ sub: 'demo-user-1', tenantId: 'trama-demo', role: 'cliente' });

const DAY = 24 * 60 * 60 * 1000;
// Fechas relativas a hoy para que la suite no caduque.
const inDays = (days) => new Date(Date.now() + days * DAY).toISOString();

test('GET /api/v1/profiles/me/unavailability sin Authorization responde 401', async () => {
  const res = await request(app).get('/api/v1/profiles/me/unavailability');

  assert.equal(res.status, 401);
  assert.equal(res.body.error, 'Encabezado Authorization requerido');
});

test('GET /api/v1/profiles/me/unavailability con rol CLIENT responde 403 (MANI-AUS-403)', async () => {
  const res = await request(app)
    .get('/api/v1/profiles/me/unavailability')
    .set('Authorization', `Bearer ${clientToken()}`);

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'MANI-AUS-403');
});

test('POST /api/v1/profiles/me/unavailability con un aliado de otro tenant responde 403', async () => {
  const token = signTestToken({ sub: 'demo-ally-1', tenantId: 'otro-tenant', role: 'aliado' });

  const res = await request(app)
    .post('/api/v1/profiles/me/unavailability')
    .set('Authorization', `Bearer ${token}`)
    .send({ startsAt: inDays(1), endsAt: inDays(2), reason: 'VACACIONES' });

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'MANI-AUS-403');
});

test('POST con horario inválido responde 422 (MANI-AUS-422H) y con formato inválido 422 (MANI-AUS-422V)', async () => {
  const inverted = await request(app)
    .post('/api/v1/profiles/me/unavailability')
    .set('Authorization', `Bearer ${allyToken()}`)
    .send({ startsAt: inDays(5), endsAt: inDays(4), reason: 'VACACIONES' });
  assert.equal(inverted.status, 422);
  assert.equal(inverted.body.code, 'MANI-AUS-422H');

  const noZone = await request(app)
    .post('/api/v1/profiles/me/unavailability')
    .set('Authorization', `Bearer ${allyToken()}`)
    .send({ startsAt: '2030-01-01T08:00:00', endsAt: inDays(4), reason: 'VACACIONES' });
  assert.equal(noZone.status, 422);
  assert.equal(noZone.body.code, 'MANI-AUS-422V');
});

test('ciclo completo: crear, cruce 409, editar, quedar no disponible y borrar', async () => {
  const auth = `Bearer ${allyToken()}`;

  const created = await request(app)
    .post('/api/v1/profiles/me/unavailability')
    .set('Authorization', auth)
    .send({ startsAt: inDays(10), endsAt: inDays(15), reason: 'VACACIONES', note: 'Viaje' });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.reason, 'VACACIONES');
  assert.equal(created.body.data.active, false);
  const id = created.body.data.id;

  const overlap = await request(app)
    .post('/api/v1/profiles/me/unavailability')
    .set('Authorization', auth)
    .send({ startsAt: inDays(14), endsAt: inDays(16), reason: 'OTRO' });
  assert.equal(overlap.status, 409);
  assert.equal(overlap.body.code, 'MANI-AUS-409');

  // Se adelanta para que cubra el instante actual: el aliado queda "No disponible".
  const edited = await request(app)
    .patch(`/api/v1/profiles/me/unavailability/${id}`)
    .set('Authorization', auth)
    .send({ startsAt: inDays(-0.1), reason: 'ENFERMEDAD' });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.data.active, true);
  assert.equal(edited.body.data.note, 'Viaje');

  const listed = await request(app).get('/api/v1/profiles/me/unavailability').set('Authorization', auth);
  assert.equal(listed.status, 200);
  assert.equal(listed.body.availableNow, false);
  assert.ok(listed.body.data.some((a) => a.id === id));

  const removed = await request(app).delete(`/profiles/me/unavailability/${id}`).set('Authorization', auth);
  assert.equal(removed.status, 204);

  const after = await request(app).get('/profiles/me/unavailability').set('Authorization', auth);
  assert.equal(after.body.availableNow, true);
  assert.ok(!after.body.data.some((a) => a.id === id));
});

test('PATCH y DELETE de una ausencia inexistente responden 404 (MANI-AUS-404)', async () => {
  const auth = `Bearer ${allyToken()}`;

  const patched = await request(app)
    .patch('/api/v1/profiles/me/unavailability/no-existe')
    .set('Authorization', auth)
    .send({ reason: 'OTRO' });
  assert.equal(patched.status, 404);
  assert.equal(patched.body.code, 'MANI-AUS-404');

  const deleted = await request(app).delete('/api/v1/profiles/me/unavailability/no-existe').set('Authorization', auth);
  assert.equal(deleted.status, 404);
});
