const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');
const ServiceEventsUseCase = require('../../../src/application/useCases/services/ServiceEventsUseCase');
const InMemoryFileStorageService = require('../../../src/infrastructure/security/InMemoryFileStorageService');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';
const RUTA = `/solicitudes/${SOLICITUD}/eventos`;

function bearer(role) {
  const token = jwt.sign({ sub: USER, app_metadata: { tenant_id: TENANT, user_role: role } }, config.supabaseJwtSecret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
  return `Bearer ${token}`;
}

function withRepo(repo, fn) {
  return async () => {
    const original = container.serviceEventsUseCase;
    container.serviceEventsUseCase = new ServiceEventsUseCase({
      serviceEventRepository: repo,
      fileStorageService: new InMemoryFileStorageService(),
    });
    try {
      await fn();
    } finally {
      container.serviceEventsUseCase = original;
    }
  };
}

const evento = { id: 'ev-1', tipo: 'EJECUCION_NOVEDAD', registradoEn: '2026-10-27T16:00:00.000Z' };

test('sin token → 401', async () => {
  const res = await request(app).post(RUTA).send({ observacion: 'Hola' });
  assert.equal(res.status, 401);
});

test(
  'multipart con foto: 201 con el tenant del token; un reintento con la misma clave responde 200',
  withRepo(
    {
      registrar: async (ctx, datos) => {
        assert.equal(ctx.tenantId, TENANT);
        assert.equal(datos.tipo, 'EJECUCION_NOVEDAD');
        assert.match(datos.evidenciaRuta, new RegExp(`^${TENANT}/${USER}/eventos/`));
        return { evento, creado: datos.claveIdempotencia !== '88888888-8888-4888-8888-888888888888' };
      },
    },
    async () => {
      const enviar = (clave) =>
        request(app)
          .post(`/api/v1${RUTA}`)
          .set('Authorization', bearer('aliado'))
          .set('X-Tenant-Id', '99999999-9999-4999-8999-999999999999')
          .field('tipo', 'NOVEDAD')
          .field('observacion', 'Hay una fuga adicional')
          .field('claveIdempotencia', clave)
          .attach('foto', Buffer.from('png'), { filename: 'fuga.png', contentType: 'image/png' });
      const primera = await enviar('77777777-7777-4777-8777-777777777777');
      assert.equal(primera.status, 201);
      assert.equal(primera.body.evento.id, 'ev-1');
      const reintento = await enviar('88888888-8888-4888-8888-888888888888');
      assert.equal(reintento.status, 200);
    }
  )
);

test('evidencia que no es imagen → 400 MANI-EVT-400', async () => {
  const res = await request(app)
    .post(RUTA)
    .set('Authorization', bearer('aliado'))
    .field('observacion', 'Adjunto')
    .attach('foto', Buffer.from('%PDF'), { filename: 'a.pdf', contentType: 'application/pdf' });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'MANI-EVT-400');
});

test('el cliente no registra eventos → 403', async () => {
  const res = await request(app).post(RUTA).set('Authorization', bearer('cliente')).send({ observacion: 'Hola' });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'MANI-EVT-403');
});

test(
  'el cliente consulta la secuencia (200)',
  withRepo({ listar: async () => [evento] }, async () => {
    const res = await request(app).get(RUTA).set('Authorization', bearer('cliente'));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.eventos, [evento]);
  })
);
