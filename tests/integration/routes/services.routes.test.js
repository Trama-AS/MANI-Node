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

test('POST /solicitudes/:id/eventos registra el evento en evento_servicio (201) con evidencia subida como archivo', async () => {
  const allyToken = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });
  const sol = nuevaSolicitud('EN_EJECUCION');

  const res = await request(app)
    .post(`/api/v1/solicitudes/${sol.id}/eventos`)
    .set('Authorization', `Bearer ${allyToken}`)
    .field('observacion', 'Se encontró termostato quemado')
    .attach('foto', Buffer.from('fake-png'), { filename: 'termostato.png', contentType: 'image/png' });

  assert.equal(res.status, 201);
  assert.equal(res.body.evento.solicitudId, sol.id);
  assert.equal(res.body.evento.tipoEvento, 'EVENTO_EJECUCION');
  assert.ok(res.body.evento.descripcion.includes('termostato'));
  assert.match(res.body.evento.evidenciaRuta, /^trama-demo\/demo-ally-1\/eventos\//);
});

test('POST /solicitudes/:id/eventos rechaza una URL de foto en el cuerpo (400) y el alias /servicios/:id/eventos ya no existe', async () => {
  const allyToken = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });
  const sol = nuevaSolicitud('EN_EJECUCION');

  const conUrl = await request(app)
    .post(`/api/v1/solicitudes/${sol.id}/eventos`)
    .set('Authorization', `Bearer ${allyToken}`)
    .send({ observacion: 'Imprevisto', fotoUrl: 'https://evil.example/x.png' });
  assert.equal(conUrl.status, 400);

  const alias = await request(app).post(`/api/v1/servicios/${sol.id}/eventos`).set('Authorization', `Bearer ${allyToken}`).send({ observacion: 'x' });
  assert.equal(alias.status, 404);
});

test('GET /solicitudes/:id/log: el cliente dueño ve el log cronológico de evento_servicio; otro cliente 403; alias retirados', async () => {
  const clientToken = signTestToken({ sub: 'demo-user-1', tenantId: 'trama-demo', role: 'cliente' });
  const otroCliente = signTestToken({ sub: 'otro-usuario', tenantId: 'trama-demo', role: 'cliente' });
  const allyToken = signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' });
  const sol = nuevaSolicitud('ASIGNADA');

  await request(app).post(`/api/v1/solicitudes/${sol.id}/iniciar`).set('Authorization', `Bearer ${allyToken}`);
  await request(app).post(`/api/v1/solicitudes/${sol.id}/eventos`).set('Authorization', `Bearer ${allyToken}`).send({ observacion: 'Revisión en marcha' });

  const res = await request(app).get(`/api/v1/solicitudes/${sol.id}/log`).set('Authorization', `Bearer ${clientToken}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.log.map((e) => e.tipoEvento), ['INICIO_EJECUCION', 'EVENTO_EJECUCION']);
  assert.ok(res.body.log[1].descripcion.includes('Revisión en marcha'));

  const aliadoAsignado = await request(app).get(`/api/v1/solicitudes/${sol.id}/log`).set('Authorization', `Bearer ${allyToken}`);
  assert.equal(aliadoAsignado.status, 200);

  const ajeno = await request(app).get(`/api/v1/solicitudes/${sol.id}/log`).set('Authorization', `Bearer ${otroCliente}`);
  assert.equal(ajeno.status, 403);

  for (const ruta of [`/api/v1/solicitudes/${sol.id}/historial`, `/api/v1/servicios/${sol.id}/log`]) {
    const alias = await request(app).get(ruta).set('Authorization', `Bearer ${clientToken}`);
    assert.equal(alias.status, 404);
  }
});

test('GET /solicitudes/historial: servicios del cliente (por cliente.id) con filtro de estado; aliado y sin perfil 403; alias retirados', async () => {
  const clientToken = signTestToken({ sub: 'demo-user-1', tenantId: 'trama-demo', role: 'cliente' });
  const finalizada = nuevaSolicitud('FINALIZADA');
  const activa = nuevaSolicitud('EN_EJECUCION');

  const todos = await request(app).get('/api/v1/solicitudes/historial').set('Authorization', `Bearer ${clientToken}`);
  assert.equal(todos.status, 200);
  const ids = todos.body.servicios.map((s) => s.id);
  assert.ok(ids.includes(finalizada.id) && ids.includes(activa.id));
  assert.ok(todos.body.servicios.every((s) => s.clienteId === 'demo-cliente-1' && s.tenantId === 'trama-demo'));

  const filtrados = await request(app).get('/api/v1/solicitudes/historial?estado=finalizada').set('Authorization', `Bearer ${clientToken}`);
  assert.ok(filtrados.body.servicios.length >= 1);
  assert.ok(filtrados.body.servicios.every((s) => s.estado === 'FINALIZADA'));

  const aliado = await request(app).get('/api/v1/solicitudes/historial').set('Authorization', `Bearer ${signTestToken({ sub: 'demo-ally-1', tenantId: 'trama-demo', role: 'aliado' })}`);
  assert.equal(aliado.status, 403);
  const sinPerfil = await request(app).get('/api/v1/solicitudes/historial').set('Authorization', `Bearer ${signTestToken({ sub: 'nadie', tenantId: 'trama-demo', role: 'cliente' })}`);
  assert.equal(sinPerfil.status, 403);
  const otroTenant = await request(app).get('/api/v1/solicitudes/historial').set('Authorization', `Bearer ${signTestToken({ sub: 'demo-user-1', tenantId: 'otro-tenant', role: 'cliente' })}`);
  assert.equal(otroTenant.status, 403);

  for (const ruta of ['/api/v1/servicios/historial', '/api/v1/solicitudes/me']) {
    const alias = await request(app).get(ruta).set('Authorization', `Bearer ${clientToken}`);
    assert.equal(alias.status, 404);
  }
});
