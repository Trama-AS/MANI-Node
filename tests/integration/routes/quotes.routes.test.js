const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');

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
