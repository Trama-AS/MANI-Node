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

const clientToken = () => signTestToken({ sub: 'demo-user-1', tenantId: 'trama-demo', role: 'cliente' });

async function emitirCotizacion() {
  const res = await request(app).post(ruta).set('Authorization', `Bearer ${allyToken()}`).send({ valorManoObra: 50000, valorMateriales: 10000 });
  assert.equal(res.status, 201);
  return res.body.cotizacion.id;
}

test('POST /cotizaciones/:id/aceptar: el cliente dueño acepta (200) y una segunda respuesta es 409', async () => {
  const id = await emitirCotizacion();

  const ok = await request(app).post(`/api/v1/cotizaciones/${id}/aceptar`).set('Authorization', `Bearer ${clientToken()}`).send({});
  assert.equal(ok.status, 200);
  assert.equal(ok.body.cotizacion.estado, 'ACEPTADA');

  const otra = await request(app).post(`/api/v1/cotizaciones/${id}/aceptar`).set('Authorization', `Bearer ${clientToken()}`).send({});
  assert.equal(otra.status, 409);
});

test('POST /cotizaciones/:id/ajustar: pide ajuste con comentario (200); sin comentario es 400', async () => {
  const id = await emitirCotizacion();

  const sinComentario = await request(app).post(`/api/v1/cotizaciones/${id}/ajustar`).set('Authorization', `Bearer ${clientToken()}`).send({});
  assert.equal(sinComentario.status, 400);

  const ok = await request(app).post(`/api/v1/cotizaciones/${id}/ajustar`).set('Authorization', `Bearer ${clientToken()}`).send({ comentario: 'Bajar materiales' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.cotizacion.estado, 'AJUSTE_SOLICITADO');
  assert.equal(ok.body.solicitud.estado, 'COTIZANDO');
});

test('responder: el aliado (403), un cliente de otro tenant (403/404) y sin token (401) no pueden', async () => {
  const id = await emitirCotizacion();
  const otroTenant = signTestToken({ sub: 'demo-user-1', tenantId: 'otro-tenant', role: 'cliente' });

  const aliado = await request(app).post(`/api/v1/cotizaciones/${id}/aceptar`).set('Authorization', `Bearer ${allyToken()}`).send({});
  assert.equal(aliado.status, 403);
  const cruzado = await request(app).post(`/api/v1/cotizaciones/${id}/aceptar`).set('Authorization', `Bearer ${otroTenant}`).send({});
  assert.ok([403, 404].includes(cruzado.status));
  const sinToken = await request(app).post(`/api/v1/cotizaciones/${id}/aceptar`).send({});
  assert.equal(sinToken.status, 401);
});

test('los alias /solicitar-ajuste y /responder ya no existen', async () => {
  const id = await emitirCotizacion();

  for (const sufijo of ['solicitar-ajuste', 'responder']) {
    const res = await request(app).post(`/api/v1/cotizaciones/${id}/${sufijo}`).set('Authorization', `Bearer ${clientToken()}`).send({ accion: 'ACEPTAR' });
    assert.equal(res.status, 404);
  }
});

test('POST /cotizaciones/:id/rechazar: exige motivo y rechaza (cierra la solicitud, por eso va al final)', async () => {
  const id = await emitirCotizacion();

  const sinMotivo = await request(app).post(`/api/v1/cotizaciones/${id}/rechazar`).set('Authorization', `Bearer ${clientToken()}`).send({});
  assert.equal(sinMotivo.status, 400);

  const ok = await request(app).post(`/api/v1/cotizaciones/${id}/rechazar`).set('Authorization', `Bearer ${clientToken()}`).send({ motivo: 'Muy costosa para el presupuesto' });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.cotizacion.estado, 'RECHAZADA');
});
