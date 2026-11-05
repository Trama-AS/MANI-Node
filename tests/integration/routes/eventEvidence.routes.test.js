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
const { NotFoundError } = require('../../../src/domain/errors/DomainError');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';
const EVENTO = '66666666-6666-4666-8666-666666666666';
const RUTA = `/solicitudes/${SOLICITUD}/eventos/${EVENTO}/evidencia`;

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

test('sin token → 401', async () => {
  const res = await request(app).get(RUTA);
  assert.equal(res.status, 401);
});

test(
  'el cliente dueño recibe la URL firmada del bucket solicitudes, sin caché (200)',
  withRepo({ rutaEvidencia: async () => `${TENANT}/u/eventos/${SOLICITUD}/f.png` }, async () => {
    const res = await request(app).get(`/api/v1${RUTA}`).set('Authorization', bearer('cliente'));
    assert.equal(res.status, 200);
    assert.match(res.body.evidencia.url, /\/solicitudes\//);
    assert.equal(res.body.evidencia.expiraEnSegundos, 300);
    assert.equal(res.headers['cache-control'], 'no-store');
  })
);

test(
  'un evento sin foto → 404 MANI-EVT-404E',
  withRepo(
    {
      rutaEvidencia: async () => {
        throw new NotFoundError('MANI-EVT-404E: el evento no tiene evidencia', 'MANI-EVT-404E');
      },
    },
    async () => {
      const res = await request(app).get(RUTA).set('Authorization', bearer('cliente'));
      assert.equal(res.status, 404);
      assert.equal(res.body.code, 'MANI-EVT-404E');
    }
  )
);

test('la ruta de evidencia no captura la lista de eventos', async () => {
  const res = await request(app).get(`/solicitudes/${SOLICITUD}/eventos`);
  assert.equal(res.status, 401);
});
