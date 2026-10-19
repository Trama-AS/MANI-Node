process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');

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

test('POST /api/v1/cotizaciones/:id/aceptar acepta la cotización exitosamente', async () => {
  const allyToken = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });
  const clientToken = signTestToken({ sub: 'demo-client-1', tenantId: 'trama-demo', role: 'cliente' });

  // Crear cotización
  const createRes = await request(app)
    .post('/api/v1/cotizaciones')
    .set('Authorization', `Bearer ${allyToken}`)
    .send({
      solicitudId: 'sol-demo-1',
      valorManoObra: 75000,
    });
  assert.equal(createRes.status, 201);
  const cotId = createRes.body.cotizacion.id;

  // Aceptar cotización por el cliente
  const acceptRes = await request(app)
    .post(`/api/v1/cotizaciones/${cotId}/aceptar`)
    .set('Authorization', `Bearer ${clientToken}`)
    .send({ comentario: 'Acepto la propuesta' });

  assert.equal(acceptRes.status, 200);
  assert.equal(acceptRes.body.cotizacion.estado, 'ACEPTADA');
  assert.equal(acceptRes.body.solicitud.estado, 'ACEPTADA');

  // Doble acción protegida (409 Conflict)
  const repeatRes = await request(app)
    .post(`/api/v1/cotizaciones/${cotId}/aceptar`)
    .set('Authorization', `Bearer ${clientToken}`);

  assert.equal(repeatRes.status, 409);
  assert.equal(repeatRes.body.code, 'CONFLICT');
});

test('POST /api/v1/cotizaciones/:id/rechazar rechaza con motivo válido', async () => {
  const allyToken = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });
  const clientToken = signTestToken({ sub: 'demo-client-1', tenantId: 'trama-demo', role: 'cliente' });

  // Crear una nueva solicitud limpia para esta prueba
  const sol = await container.solicitudRepository.create({
    tenantId: 'trama-demo',
    clienteId: 'demo-client-1',
    aliadoId: 'demo-ally-1',
    categoriaId: 'cat-plomeria',
    zonaId: 'zona-norte',
    descripcion: 'Reparación tubería',
    estado: 'ASIGNADA',
  });

  const createRes = await request(app)
    .post('/api/v1/cotizaciones')
    .set('Authorization', `Bearer ${allyToken}`)
    .send({
      solicitudId: sol.id,
      valorManoObra: 120000,
    });
  const cotId = createRes.body.cotizacion.id;

  // Sin motivo debe responder 400
  const badRes = await request(app)
    .post(`/api/v1/cotizaciones/${cotId}/rechazar`)
    .set('Authorization', `Bearer ${clientToken}`)
    .send({});
  assert.equal(badRes.status, 400);

  // Con motivo responde 200
  const rejectRes = await request(app)
    .post(`/api/v1/cotizaciones/${cotId}/rechazar`)
    .set('Authorization', `Bearer ${clientToken}`)
    .send({ motivo: 'Demasiado costoso para mi presupuesto actual' });

  assert.equal(rejectRes.status, 200);
  assert.equal(rejectRes.body.cotizacion.estado, 'RECHAZADA');
  assert.equal(rejectRes.body.solicitud.estado, 'RECHAZADA');
});

test('POST /api/v1/cotizaciones/:id/solicitar-ajuste solicita cambios en la cotización', async () => {
  const allyToken = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });
  const clientToken = signTestToken({ sub: 'demo-client-1', tenantId: 'trama-demo', role: 'cliente' });

  const createRes = await request(app)
    .post('/api/v1/cotizaciones')
    .set('Authorization', `Bearer ${allyToken}`)
    .send({
      solicitudId: 'sol-demo-1',
      valorManoObra: 95000,
      valorMateriales: 35000,
    });
  const cotId = createRes.body.cotizacion.id;

  const adjustRes = await request(app)
    .post(`/api/v1/cotizaciones/${cotId}/solicitar-ajuste`)
    .set('Authorization', `Bearer ${clientToken}`)
    .send({ comentario: '¿Es posible usar materiales genéricos para bajar costos?' });

  assert.equal(adjustRes.status, 200);
  assert.equal(adjustRes.body.cotizacion.estado, 'AJUSTE_SOLICITADO');
  assert.equal(adjustRes.body.solicitud.estado, 'COTIZANDO');
});
