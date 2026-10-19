process.env.NODE_ENV = process.env.NODE_ENV || 'test';
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

let contador = 0;
function nuevaSolicitud(estado) {
  contador += 1;
  return container.solicitudRepository.seed({
    id: `sol-ejec-${contador}`,
    tenantId: 'trama-demo',
    clienteId: 'demo-cliente-1',
    aliadoId: 'demo-aliado-1',
    categoriaId: 'cat-plomeria',
    zonaId: 'zona-norte',
    descripcion: 'Servicio de prueba',
    estado,
  });
}

test('POST /api/v1/solicitudes/:id/finalizar sin haber iniciado responde 409 CONFLICT', async () => {
  const allyToken = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });
  const sol = nuevaSolicitud('ASIGNADA');

  const res = await request(app).post(`/api/v1/solicitudes/${sol.id}/finalizar`).set('Authorization', `Bearer ${allyToken}`);

  assert.equal(res.status, 409);
  assert.equal(res.body.code, 'CONFLICT');
});

test('Flujo completo inicio -> fin: estados y eventos INICIO_EJECUCION / FIN_EJECUCION con su hora', async () => {
  const allyToken = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });
  const sol = nuevaSolicitud('ACEPTADA');

  const startRes = await request(app)
    .post(`/api/v1/solicitudes/${sol.id}/iniciar`)
    .set('Authorization', `Bearer ${allyToken}`)
    .send({ observacion: 'Llegada al sitio' });
  assert.equal(startRes.status, 200);
  assert.equal(startRes.body.solicitud.estado, 'EN_EJECUCION');
  assert.equal(startRes.body.evento.tipoEvento, 'INICIO_EJECUCION');
  assert.ok(startRes.body.evento.fecha);

  const finishRes = await request(app)
    .post(`/api/v1/solicitudes/${sol.id}/finalizar`)
    .set('Authorization', `Bearer ${allyToken}`)
    .send({ observacion: 'Reparación terminada' });
  assert.equal(finishRes.status, 200);
  assert.equal(finishRes.body.solicitud.estado, 'FINALIZADA');
  assert.equal(finishRes.body.evento.tipoEvento, 'FIN_EJECUCION');
});

test('cross-tenant y alias retirados: otro tenant no ve la solicitud y /iniciar-ejecucion ya no existe', async () => {
  const sol = nuevaSolicitud('ACEPTADA');
  const otroTenant = signTestToken({ sub: 'demo-ally-1', tenantId: 'otro-tenant', role: 'aliado' });
  const allyToken = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });

  const cruzado = await request(app).post(`/api/v1/solicitudes/${sol.id}/iniciar`).set('Authorization', `Bearer ${otroTenant}`);
  assert.ok([403, 404].includes(cruzado.status));

  for (const ruta of [`/api/v1/solicitudes/${sol.id}/iniciar-ejecucion`, `/api/v1/servicios/${sol.id}/iniciar`, `/api/v1/solicitudes/${sol.id}/finalizar-ejecucion`]) {
    const res = await request(app).post(ruta).set('Authorization', `Bearer ${allyToken}`);
    assert.equal(res.status, 404);
  }
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
