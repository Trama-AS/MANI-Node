process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');
const CreateServiceRequestUseCase = require('../../../src/application/useCases/requests/CreateServiceRequestUseCase');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const CAT = '33333333-3333-4333-8333-333333333333';
const SITIO = '55555555-5555-4555-8555-555555555555';
const descripcion = 'Fuga de agua en el baño principal desde ayer';

function token({ role = 'cliente', sub = USER, tenantId = TENANT, secret = config.supabaseJwtSecret, expiresIn = '1h' } = {}) {
  return jwt.sign({ sub, app_metadata: { tenant_id: tenantId, user_role: role } }, secret, { algorithm: 'HS256', expiresIn });
}

function conRepositorio(crear, fn) {
  return async () => {
    const original = container.createServiceRequestUseCase;
    container.createServiceRequestUseCase = new CreateServiceRequestUseCase({
      serviceRequestRepository: { crear },
      fileStorageService: { upload: async ({ path }) => ({ path }), delete: async () => {} },
    });
    try {
      await fn();
    } finally {
      container.createServiceRequestUseCase = original;
    }
  };
}

test('POST /solicitudes sin token, con token expirado o firmado con otro secreto responde 401', async () => {
  for (const auth of [null, token({ expiresIn: -60 }), token({ secret: 'otro-secreto' })]) {
    const req = request(app).post('/api/v1/solicitudes');
    if (auth) req.set('Authorization', `Bearer ${auth}`);
    const res = await req.send({ categoriaId: CAT, descripcion, sitioId: SITIO });
    assert.equal(res.status, 401);
  }
});

test('POST /solicitudes con rol aliado responde 403', async () => {
  const res = await request(app).post('/api/v1/solicitudes').set('Authorization', `Bearer ${token({ role: 'aliado' })}`).send({ categoriaId: CAT, descripcion, sitioId: SITIO });

  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'MANI-SOL-403C');
});

test('POST /solicitudes con datos inválidos responde 422 con el código MANI-SOL', async () => {
  const res = await request(app).post('/api/v1/solicitudes').set('Authorization', `Bearer ${token()}`).send({ categoriaId: CAT, descripcion: 'corta', sitioId: SITIO });

  assert.equal(res.status, 422);
  assert.equal(res.body.code, 'MANI-SOL-422D');
});

test('POST /solicitudes multipart con fotos: 201 y el repositorio recibe el tenant del token y las rutas subidas', conRepositorio(
  async (ctx, datos) => ({ solicitud: { id: 'sol-1', estado: 'PENDIENTE', tenant: ctx.tenantId, fotos: datos.fotos.length }, creada: true }),
  async () => {
    const res = await request(app)
      .post('/api/v1/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .set('X-Tenant-Id', '99999999-9999-4999-8999-999999999999')
      .field('categoriaId', CAT)
      .field('descripcion', descripcion)
      .field('sitioId', SITIO)
      .attach('fotos', Buffer.from('a'), { filename: 'a.png', contentType: 'image/png' })
      .attach('fotos', Buffer.from('b'), { filename: 'b.jpg', contentType: 'image/jpeg' });

    assert.equal(res.status, 201);
    assert.equal(res.body.solicitud.estado, 'PENDIENTE');
    assert.equal(res.body.solicitud.tenant, TENANT);
    assert.equal(res.body.solicitud.fotos, 2);
  }
));

test('POST /solicitudes con la misma clave de idempotencia responde 200 con la solicitud existente', conRepositorio(
  async () => ({ solicitud: { id: 'sol-previa' }, creada: false }),
  async () => {
    const res = await request(app)
      .post('/api/v1/solicitudes')
      .set('Authorization', `Bearer ${token()}`)
      .send({ categoriaId: CAT, descripcion, sitioId: SITIO, claveIdempotencia: '66666666-6666-4666-8666-666666666666' });

    assert.equal(res.status, 200);
    assert.equal(res.body.solicitud.id, 'sol-previa');
  }
));

test('sin DATABASE_URL la creación falla cerrado con 503', async (t) => {
  if (container.pgPoolFactory.isConfigured()) {
    t.skip('DATABASE_URL está configurada');
    return;
  }
  const res = await request(app).post('/api/v1/solicitudes').set('Authorization', `Bearer ${token()}`).send({ categoriaId: CAT, descripcion, sitioId: SITIO });

  assert.equal(res.status, 503);
});
