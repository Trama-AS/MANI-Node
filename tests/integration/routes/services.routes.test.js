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

test('POST /api/v1/solicitudes/:id/iniciar sin token responde 401', async () => {
  const res = await request(app).post('/api/v1/solicitudes/sol-demo-1/iniciar');
  assert.equal(res.status, 401);
});

test('POST /api/v1/solicitudes/:id/iniciar con rol CLIENT responde 403 FORBIDDEN', async () => {
  const token = signTestToken({ sub: 'demo-client-1', tenantId: 'trama-demo', role: 'cliente' });
  const res = await request(app)
    .post('/api/v1/solicitudes/sol-demo-1/iniciar')
    .set('Authorization', `Bearer ${token}`);

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'FORBIDDEN');
});

test('POST /api/v1/solicitudes/:id/finalizar sin haber iniciado responde 409 CONFLICT', async () => {
  const allyToken = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });
  const sol = await container.solicitudRepository.create({
    tenantId: 'trama-demo',
    clienteId: 'demo-client-1',
    aliadoId: 'demo-ally-1',
    categoriaId: 'cat-plomeria',
    zonaId: 'zona-norte',
    descripcion: 'Instalación lavamanos',
    estado: 'ASIGNADA',
  });

  const res = await request(app)
    .post(`/api/v1/solicitudes/${sol.id}/finalizar`)
    .set('Authorization', `Bearer ${allyToken}`);

  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'CONFLICT');
  assert.ok(res.body.error.includes('no ha sido iniciado'));
});

test('Flujo completo inicio -> fin de ejecución con persistencia de timestamps y estados', async () => {
  const allyToken = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });
  const sol = await container.solicitudRepository.create({
    tenantId: 'trama-demo',
    clienteId: 'demo-client-1',
    aliadoId: 'demo-ally-1',
    categoriaId: 'cat-plomeria',
    zonaId: 'zona-norte',
    descripcion: 'Cambio de empaques',
    estado: 'ACEPTADA',
  });

  // 1. Iniciar ejecución
  const startRes = await request(app)
    .post(`/api/v1/solicitudes/${sol.id}/iniciar`)
    .set('Authorization', `Bearer ${allyToken}`)
    .send({ observacion: 'Llegada al sitio' });

  assert.equal(startRes.status, 200);
  assert.equal(startRes.body.solicitud.estado, 'EN_EJECUCION');
  assert.ok(startRes.body.solicitud.fechaInicioEjecucion);

  // 2. Finalizar ejecución
  const finishRes = await request(app)
    .post(`/api/v1/solicitudes/${sol.id}/finalizar`)
    .set('Authorization', `Bearer ${allyToken}`)
    .send({ observacion: 'Reparación terminada con éxito' });

  assert.equal(finishRes.status, 200);
  assert.equal(finishRes.body.solicitud.estado, 'FINALIZADA');
  assert.ok(finishRes.body.solicitud.fechaFinEjecucion);
});

test('POST /api/v1/solicitudes/:id/eventos registra evento e imprevisto con 201 Created', async () => {
  const allyToken = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });
  const sol = await container.solicitudRepository.create({
    tenantId: 'trama-demo',
    clienteId: 'demo-client-1',
    aliadoId: 'demo-ally-1',
    categoriaId: 'cat-plomeria',
    zonaId: 'zona-norte',
    descripcion: 'Reparación de calentador',
    estado: 'EN_EJECUCION',
  });

  const res = await request(app)
    .post(`/api/v1/solicitudes/${sol.id}/eventos`)
    .set('Authorization', `Bearer ${allyToken}`)
    .send({
      observacion: 'Se encontró termostato quemado, se cotiza reemplazo',
      fotoUrl: 'https://cdn.mani.local/fotos/termostato.png',
    });

  assert.equal(res.status, 201);
  assert.ok(res.body.evento.id);
  assert.equal(res.body.evento.solicitudId, sol.id);
  assert.equal(res.body.evento.fotoUrl, 'https://cdn.mani.local/fotos/termostato.png');
  assert.ok(res.body.evento.observacion.includes('termostato'));
});

test('GET /api/v1/solicitudes/:id/log devuelve historial cronológico al cliente autorizado', async () => {
  const clientToken = signTestToken({ sub: 'demo-client-1', tenantId: 'trama-demo', role: 'cliente' });
  const allyToken = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });

  const sol = await container.solicitudRepository.create({
    tenantId: 'trama-demo',
    clienteId: 'demo-client-1',
    aliadoId: 'demo-ally-1',
    categoriaId: 'cat-plomeria',
    zonaId: 'zona-norte',
    descripcion: 'Revisión técnica',
    estado: 'ASIGNADA',
  });

  // Generar eventos
  await request(app)
    .post(`/api/v1/solicitudes/${sol.id}/iniciar`)
    .set('Authorization', `Bearer ${allyToken}`);

  await request(app)
    .post(`/api/v1/solicitudes/${sol.id}/eventos`)
    .set('Authorization', `Bearer ${allyToken}`)
    .send({ observacion: 'Revisión en marcha' });

  // Consultar log por el cliente
  const res = await request(app)
    .get(`/api/v1/solicitudes/${sol.id}/log`)
    .set('Authorization', `Bearer ${clientToken}`);

  assert.equal(res.status, 200);
  assert.equal(res.body.solicitud.id, sol.id);
  assert.ok(Array.isArray(res.body.log));
  assert.equal(res.body.log.length, 2);
  assert.equal(res.body.log[0].estadoNuevo, 'EN_EJECUCION');
  assert.ok(res.body.log[1].observacion.includes('Revisión en marcha'));
});
