const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');
const MessagesUseCase = require('../../../src/application/useCases/messages/MessagesUseCase');
const { NotFoundError } = require('../../../src/domain/errors/DomainError');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SOLICITUD = '33333333-3333-4333-8333-333333333333';
const MENSAJE = '55555555-5555-4555-8555-555555555555';

function bearer({ role = 'cliente' } = {}) {
  const token = jwt.sign({ sub: USER, app_metadata: { tenant_id: TENANT, user_role: role } }, config.supabaseJwtSecret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
  return `Bearer ${token}`;
}

const mensaje = { id: MENSAJE, solicitudId: SOLICITUD, contenido: 'hola', creadoEn: '2026-10-27T10:00:00.000Z', remitente: { rol: 'CLIENT' }, mio: true };

// Sustituye el caso de uso del container por uno con repositorio falso y lo restaura al terminar.
function conMensajes(repo, fn) {
  return async () => {
    const original = container.messagesUseCase;
    const llamadas = [];
    container.messagesUseCase = new MessagesUseCase({
      messageRepository: {
        enviar: async (ctx, datos) => (llamadas.push({ ctx, datos }), repo.enviar ? repo.enviar(ctx, datos) : { mensaje, creado: true }),
        listar: async (ctx, datos) => (llamadas.push({ ctx, datos }), repo.listar ? repo.listar(ctx, datos) : { mensajes: [mensaje] }),
      },
    });
    try {
      await fn(llamadas);
    } finally {
      container.messagesUseCase = original;
    }
  };
}

const url = `/api/v1/solicitudes/${SOLICITUD}/mensajes`;

test('sin Authorization ambas rutas responden 401', async () => {
  assert.equal((await request(app).post(url).send({ contenido: 'hola' })).status, 401);
  assert.equal((await request(app).get(url)).status, 401);
});

test('un rol que no participa recibe 403 y no se toca el repositorio', conMensajes({}, async (llamadas) => {
  const res = await request(app).post(url).set('Authorization', bearer({ role: 'admin_tenant' })).send({ contenido: 'hola' });
  assert.equal(res.status, 403);
  assert.equal((await request(app).get(url).set('Authorization', bearer({ role: 'admin_tenant' }))).status, 403);
  assert.equal(llamadas.length, 0);
}));

test('POST responde 201 con el mensaje y el correlationId; el tenant sale del JWT', conMensajes({}, async (llamadas) => {
  const res = await request(app).post(url).set('Authorization', bearer()).send({ contenido: 'hola', tenantId: 'otro' });

  assert.equal(res.status, 201);
  assert.equal(res.body.mensaje.id, MENSAJE);
  assert.ok(res.body.correlationId);
  assert.equal(llamadas[0].ctx.tenantId, TENANT);
  assert.equal(llamadas[0].ctx.userId, USER);
}));

test('POST con la misma clave de idempotencia responde 200 (no duplica)', conMensajes({ enviar: async () => ({ mensaje, creado: false }) }, async () => {
  const res = await request(app).post(url).set('Authorization', bearer()).send({ contenido: 'hola', claveIdempotencia: '44444444-4444-4444-8444-444444444444' });
  assert.equal(res.status, 200);
}));

test('POST con contenido vacío responde 400 con código MANI-MSG-400', conMensajes({}, async (llamadas) => {
  const res = await request(app).post(url).set('Authorization', bearer()).send({ contenido: '   ' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'MANI-MSG-400');
  assert.equal(llamadas.length, 0);
}));

test('una solicitud ajena responde 404 en ambas rutas', conMensajes({
  enviar: async () => { throw new NotFoundError('MANI-MSG-404: solicitud no encontrada', 'MANI-MSG-404'); },
  listar: async () => { throw new NotFoundError('MANI-MSG-404: solicitud no encontrada', 'MANI-MSG-404'); },
}, async () => {
  assert.equal((await request(app).post(url).set('Authorization', bearer()).send({ contenido: 'hola' })).status, 404);
  const res = await request(app).get(url).set('Authorization', bearer());
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'MANI-MSG-404');
}));

test('GET devuelve el hilo sin caché y pasa despuesDe y limite al repositorio', conMensajes({}, async (llamadas) => {
  const res = await request(app).get(`${url}?despuesDe=${MENSAJE}&limite=20`).set('Authorization', bearer({ role: 'aliado' }));

  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.body.mensajes.length, 1);
  assert.deepEqual(llamadas[0].datos, { solicitudId: SOLICITUD, despuesDe: MENSAJE, limite: 20 });
  assert.equal(llamadas[0].ctx.role, 'ALLY');
}));

test('GET con límite fuera de rango responde 400', conMensajes({}, async () => {
  assert.equal((await request(app).get(`${url}?limite=500`).set('Authorization', bearer())).status, 400);
}));
