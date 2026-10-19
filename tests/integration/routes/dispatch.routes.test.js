const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');
const ListEligibleAlliesUseCase = require('../../../src/application/useCases/dispatch/ListEligibleAlliesUseCase');
const GetSolicitudContextUseCase = require('../../../src/application/useCases/dispatch/GetSolicitudContextUseCase');
const PublishNotificationUseCase = require('../../../src/application/useCases/dispatch/PublishNotificationUseCase');
const ListNotificationsUseCase = require('../../../src/application/useCases/dispatch/ListNotificationsUseCase');

const TENANT = '11111111-1111-4111-8111-111111111111';
const CATEGORIA = '33333333-3333-4333-8333-333333333333';
const ZONA = '44444444-4444-4444-8444-444444444444';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';
const ALLY = '66666666-6666-4666-8666-666666666666';

function tokenFor({ tenantId = TENANT, role = 'cliente' } = {}) {
  return jwt.sign({ sub: 'user-1', app_metadata: { tenant_id: tenantId, user_role: role } }, config.supabaseJwtSecret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
}

const bearer = (opts) => `Bearer ${tokenFor(opts)}`;

// Sustituye los casos de uso del container por dobles y los restaura al terminar cada prueba.
function withFakes(fakes, fn) {
  return async () => {
    const original = {};
    for (const key of Object.keys(fakes)) original[key] = container[key];
    Object.assign(container, fakes);
    try {
      await fn();
    } finally {
      Object.assign(container, original);
    }
  };
}

const eligibleFake = (calls) => ({
  listEligibleAlliesUseCase: new ListEligibleAlliesUseCase({
    elegibilidadRepository: {
      findEligible: async (criteria) => {
        calls.push(criteria);
        return {
          allies: [{ id: ALLY, nombreRazonSocial: 'Ana', tipo: 'PERSONA_NATURAL', estadoVerificacion: 'VERIFICADO' }],
          totalCount: 1,
        };
      },
    },
  }),
});

test('GET /allies/eligible sin Authorization responde 401', async () => {
  const res = await request(app).get('/api/v1/allies/eligible');

  assert.equal(res.status, 401);
});

test('GET /allies/eligible con un token inválido responde 401', async () => {
  const res = await request(app).get('/api/v1/allies/eligible').set('Authorization', 'Bearer falso');

  assert.equal(res.status, 401);
});

test('GET /allies/eligible usa el tenant del token y no el de la cabecera X-Tenant-Id', withFakes(eligibleFake([]), async () => {
  const calls = [];
  Object.assign(container, eligibleFake(calls));

  const res = await request(app)
    .get('/api/v1/allies/eligible')
    .query({ categoriaId: CATEGORIA, zonaId: ZONA, tipo: 'PERSONA_NATURAL' })
    .set('Authorization', bearer())
    .set('X-Tenant-Id', '99999999-9999-4999-8999-999999999999');

  assert.equal(res.status, 200);
  assert.equal(res.body.totalCount, 1);
  assert.equal(res.body.allies[0].nombreRazonSocial, 'Ana');
  assert.equal(calls[0].tenantId, TENANT);
  assert.equal(calls[0].tipo, 'PERSONA_NATURAL');
}));

test('GET /allies/eligible también responde en la raíz (el Gateway recorta el prefijo)', withFakes(eligibleFake([]), async () => {
  const res = await request(app)
    .get('/allies/eligible')
    .query({ categoriaId: CATEGORIA, zonaId: ZONA })
    .set('Authorization', bearer({ role: 'admin_tenant' }));

  assert.equal(res.status, 200);
}));

test('GET /allies/eligible con un aliado responde 403', withFakes(eligibleFake([]), async () => {
  const res = await request(app)
    .get('/api/v1/allies/eligible')
    .query({ categoriaId: CATEGORIA, zonaId: ZONA })
    .set('Authorization', bearer({ role: 'aliado' }));

  assert.equal(res.status, 403);
}));

test('GET /allies/eligible con parámetros inválidos responde 400', withFakes(eligibleFake([]), async () => {
  const res = await request(app)
    .get('/api/v1/allies/eligible')
    .query({ categoriaId: 'x', zonaId: ZONA })
    .set('Authorization', bearer());

  assert.equal(res.status, 400);
}));

test('GET /solicitudes/:id/context devuelve la solicitud o 404', async () => {
  const fake = {
    getSolicitudContextUseCase: new GetSolicitudContextUseCase({
      solicitudContextRepository: {
        findContext: async (tenantId, id) =>
          id === SOLICITUD ? { id, tenantId, zonaId: ZONA, categoriaId: CATEGORIA, estado: 'PUBLICADA' } : null,
      },
    }),
  };
  await withFakes(fake, async () => {
    const ok = await request(app).get(`/api/v1/solicitudes/${SOLICITUD}/context`).set('Authorization', bearer());
    assert.equal(ok.status, 200);
    assert.equal(ok.body.zonaId, ZONA);
    assert.equal(ok.body.tenantId, TENANT);

    const missing = await request(app)
      .get('/api/v1/solicitudes/77777777-7777-4777-8777-777777777777/context')
      .set('Authorization', bearer());
    assert.equal(missing.status, 404);
  })();
});

test('POST /notifications publica la oferta con el tenant del token', async () => {
  const created = [];
  const fake = {
    publishNotificationUseCase: new PublishNotificationUseCase({
      notificacionRepository: { createForAlly: async (n) => { created.push(n); return { id: 'n1' }; } },
    }),
  };
  await withFakes(fake, async () => {
    const res = await request(app)
      .post('/api/v1/notifications')
      .set('Authorization', bearer())
      .send({ allyId: ALLY, tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload: { requestId: SOLICITUD } });

    assert.equal(res.status, 201);
    assert.equal(created[0].tenantId, TENANT);

    const cross = await request(app)
      .post('/api/v1/notifications')
      .set('Authorization', bearer())
      .send({ tenantId: '99999999-9999-4999-8999-999999999999', allyId: ALLY, tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload: { requestId: SOLICITUD } });
    assert.equal(cross.status, 403);
    assert.equal(created.length, 1);
  })();
});

test('POST /notifications sin Authorization responde 401', async () => {
  const res = await request(app).post('/api/v1/notifications').send({});

  assert.equal(res.status, 401);
});

test('GET /notifications devuelve las ofertas de la solicitud', async () => {
  const fake = {
    listNotificationsUseCase: new ListNotificationsUseCase({
      notificacionRepository: {
        listByRequest: async () => [{ payload: { requestId: SOLICITUD, allyId: ALLY }, enviadoAt: new Date('2026-10-18T10:00:00Z') }],
      },
    }),
  };
  await withFakes(fake, async () => {
    const res = await request(app)
      .get('/api/v1/notifications')
      .query({ requestId: SOLICITUD, tipo: 'OFERTA_DESPACHO' })
      .set('Authorization', bearer());

    assert.equal(res.status, 200);
    assert.equal(res.body[0].allyId, ALLY);
    assert.equal(res.body[0].timestamp, '2026-10-18T10:00:00.000Z');
  })();
});

test('sin DATABASE_URL las rutas fallan cerrado con 503 en lugar de devolver datos', async (t) => {
  if (container.pgPoolFactory.isConfigured()) {
    t.skip('DATABASE_URL está configurada');
    return;
  }

  const res = await request(app)
    .get('/api/v1/allies/eligible')
    .query({ categoriaId: CATEGORIA, zonaId: ZONA })
    .set('Authorization', bearer());

  assert.equal(res.status, 503);
});

test('GET /notifications sin requestId responde 400 y con un aliado 403', async () => {
  const fake = {
    listNotificationsUseCase: new ListNotificationsUseCase({ notificacionRepository: { listByRequest: async () => [] } }),
  };
  await withFakes(fake, async () => {
    const sinRequest = await request(app).get('/api/v1/notifications').set('Authorization', bearer());
    assert.equal(sinRequest.status, 400);

    const aliado = await request(app)
      .get('/api/v1/notifications')
      .query({ requestId: SOLICITUD })
      .set('Authorization', bearer({ role: 'aliado' }));
    assert.equal(aliado.status, 403);
  })();
});

test('GET /solicitudes/:id/context con un id inválido responde 400', async () => {
  const fake = {
    getSolicitudContextUseCase: new GetSolicitudContextUseCase({ solicitudContextRepository: { findContext: async () => null } }),
  };
  await withFakes(fake, async () => {
    const res = await request(app).get('/api/v1/solicitudes/no-es-uuid/context').set('Authorization', bearer());
    assert.equal(res.status, 400);
  })();
});
