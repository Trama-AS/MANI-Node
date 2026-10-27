process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const config = require('../../../src/config');

const CIUDAD = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a12';
const CHAPINERO = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a13';
const CHICO_NORTE = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a15';
const INACTIVA = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a16';
const DESCONOCIDA = 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd3809ff';

function signToken({ userId = 'user-1', tenantId = 'tenant-a', role = 'admin_tenant', expiresIn = '1h' } = {}) {
  return jwt.sign(
    {
      sub: userId,
      app_metadata: { tenant_id: tenantId, user_role: role },
    },
    config.supabaseJwtSecret,
    { algorithm: 'HS256', expiresIn }
  );
}

describe('Catálogo jerárquico de zonas - HTTP (HU-M04-04, REST-01)', () => {
  // --- C3: autorización en el borde ---

  it('GET /api/v1/catalog/zones sin Authorization responde 401', async () => {
    const res = await request(app).get('/api/v1/catalog/zones');

    assert.strictEqual(res.status, 401);
  });

  it('GET /api/v1/catalog/zones/:id sin Authorization responde 401', async () => {
    const res = await request(app).get(`/api/v1/catalog/zones/${CIUDAD}`);

    assert.strictEqual(res.status, 401);
  });

  it('GET /api/v1/catalog/zones con token expirado responde 401', async () => {
    const token = signToken({ expiresIn: '-1h' });

    const res = await request(app).get('/api/v1/catalog/zones').set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 401);
  });

  // --- C1: la jerarquía se consulta por el contrato ---

  it('GET /api/v1/catalog/zones devuelve el árbol anidado y la lista plana', async () => {
    const token = signToken();

    const res = await request(app)
      .get('/api/v1/catalog/zones?onlyActive=true')
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.tree.map((n) => n.id), [CIUDAD]);
    assert.ok(Array.isArray(res.body.zones));
    assert.ok(res.body.zones.some((z) => z.id === CHICO_NORTE));
    assert.deepStrictEqual(res.body.inconsistencies, []);
  });

  it('GET /api/v1/catalog/zones/:id devuelve la zona con ancestros e hijos', async () => {
    const token = signToken();

    const res = await request(app)
      .get(`/api/v1/catalog/zones/${CHAPINERO}`)
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.zone.id, CHAPINERO);
    assert.deepStrictEqual(res.body.ancestors.map((a) => a.id), [CIUDAD]);
    assert.deepStrictEqual(res.body.children.map((c) => c.id), [CHICO_NORTE]);
  });

  it('GET /api/v1/catalog/zones?level=BARRIO recorta al nivel pedido', async () => {
    const token = signToken();

    const res = await request(app)
      .get('/api/v1/catalog/zones?level=BARRIO&onlyActive=true')
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 200);
    assert.deepStrictEqual(res.body.zones.map((z) => z.id), [CHICO_NORTE]);
  });

  // --- C2: escenarios negativos ---

  it('GET /api/v1/catalog/zones?level=DEPARTAMENTO responde 400 del contrato', async () => {
    const token = signToken();

    const res = await request(app)
      .get('/api/v1/catalog/zones?level=DEPARTAMENTO')
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, 'MANI-ZON-400');
  });

  it('GET /api/v1/catalog/zones?parentId desconocido responde 404, no lista vacía', async () => {
    const token = signToken();

    const res = await request(app)
      .get(`/api/v1/catalog/zones?parentId=${DESCONOCIDA}`)
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.code, 'MANI-ZON-404');
  });

  it('GET /api/v1/catalog/zones/:id con id que no es UUID responde 400', async () => {
    const token = signToken();

    const res = await request(app).get('/api/v1/catalog/zones/chapinero').set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.code, 'MANI-ZON-400');
  });

  it('GET /api/v1/catalog/zones/:id con UUID desconocido responde 404', async () => {
    const token = signToken();

    const res = await request(app)
      .get(`/api/v1/catalog/zones/${DESCONOCIDA}`)
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 404);
    assert.strictEqual(res.body.code, 'MANI-ZON-404');
  });

  it('GET /api/v1/catalog/zones?onlyActive=true no ofrece la zona desactivada', async () => {
    const token = signToken();

    const res = await request(app)
      .get('/api/v1/catalog/zones?onlyActive=true')
      .set('Authorization', `Bearer ${token}`);

    assert.ok(!res.body.zones.some((z) => z.id === INACTIVA));
    assert.ok(res.body.zones.every((z) => z.selectable === true));
  });

  it('GET /api/v1/catalog/zones sin onlyActive devuelve la desactivada como no seleccionable', async () => {
    const token = signToken();

    const res = await request(app).get('/api/v1/catalog/zones').set('Authorization', `Bearer ${token}`);

    const inactiva = res.body.zones.find((z) => z.id === INACTIVA);
    assert.strictEqual(inactiva.selectable, false);
  });

  // --- C3: el catálogo es global y no depende del tenant enviado por el cliente ---

  it('el catálogo es el mismo para dos tenants: zona no tiene datos privados por tenant', async () => {
    const tokenA = signToken({ tenantId: 'tenant-a', userId: 'user-a' });
    const tokenB = signToken({ tenantId: 'tenant-b', userId: 'user-b' });

    const resA = await request(app).get('/api/v1/catalog/zones').set('Authorization', `Bearer ${tokenA}`);
    const resB = await request(app).get('/api/v1/catalog/zones').set('Authorization', `Bearer ${tokenB}`);

    assert.strictEqual(resA.status, 200);
    assert.strictEqual(resB.status, 200);
    assert.deepStrictEqual(resA.body.zones, resB.body.zones);
  });

  it('un X-Tenant-Id enviado por el cliente no cambia la respuesta: el tenant sale del claim', async () => {
    const token = signToken({ tenantId: 'tenant-a' });

    const limpio = await request(app).get('/api/v1/catalog/zones').set('Authorization', `Bearer ${token}`);
    const suplantado = await request(app)
      .get('/api/v1/catalog/zones')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Tenant-Id', 'tenant-b')
      .set('X-Tenant-Slug', 'tenant-b');

    assert.deepStrictEqual(suplantado.body, limpio.body);
  });

  it('un aliado autenticado consulta el catálogo: es un catálogo compartido, no de Backoffice', async () => {
    const token = signToken({ role: 'aliado', userId: 'aliado-1' });

    const res = await request(app)
      .get('/api/v1/catalog/zones?onlyActive=true')
      .set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 200);
    assert.ok(res.body.zones.length > 0);
  });

  // El Gateway recorta "/api/v1/core/" completo antes de reenviar (nginx.conf),
  // así que la ruta también debe responder en la raíz.
  it('la ruta responde también en la raíz, como la recibe Core detrás del Gateway', async () => {
    const token = signToken();

    const res = await request(app).get('/catalog/zones').set('Authorization', `Bearer ${token}`);

    assert.strictEqual(res.status, 200);
  });
});
