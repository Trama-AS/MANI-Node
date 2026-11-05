const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');
const ServiceExecutionUseCase = require('../../../src/application/useCases/services/ServiceExecutionUseCase');
const { ConflictError } = require('../../../src/domain/errors/DomainError');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';

function bearer(role) {
  const token = jwt.sign({ sub: USER, app_metadata: { tenant_id: TENANT, user_role: role } }, config.supabaseJwtSecret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
  return `Bearer ${token}`;
}

function withRepo(repo, fn) {
  return async () => {
    const original = container.serviceExecutionUseCase;
    container.serviceExecutionUseCase = new ServiceExecutionUseCase({ serviceExecutionRepository: repo });
    try {
      await fn();
    } finally {
      container.serviceExecutionUseCase = original;
    }
  };
}

test('sin token → 401', async () => {
  const res = await request(app).post(`/solicitudes/${SOLICITUD}/iniciar`);
  assert.equal(res.status, 401);
});

test(
  'iniciar y finalizar llegan con su hito y el tenant del token (200)',
  withRepo(
    {
      marcar: async (ctx, datos) => {
        assert.equal(ctx.tenantId, TENANT);
        return { solicitud: { id: SOLICITUD, estado: datos.hito === 'INICIO' ? 'EN_EJECUCION' : 'FINALIZADA' } };
      },
    },
    async () => {
      for (const [ruta, estado] of [['iniciar', 'EN_EJECUCION'], ['finalizar', 'FINALIZADA']]) {
        const res = await request(app)
          .post(`/api/v1/solicitudes/${SOLICITUD}/${ruta}`)
          .set('Authorization', bearer('aliado'))
          .set('X-Tenant-Id', '99999999-9999-4999-8999-999999999999')
          .send({ observacion: 'ok' });
        assert.equal(res.status, 200, ruta);
        assert.equal(res.body.solicitud.estado, estado);
      }
    }
  )
);

test(
  'finalizar antes de iniciar → 409 MANI-EJE-409N',
  withRepo(
    {
      marcar: async () => {
        throw new ConflictError('MANI-EJE-409N: no se puede finalizar un servicio que no ha iniciado', 'MANI-EJE-409N');
      },
    },
    async () => {
      const res = await request(app).post(`/solicitudes/${SOLICITUD}/finalizar`).set('Authorization', bearer('aliado'));
      assert.equal(res.status, 409);
      assert.equal(res.body.code, 'MANI-EJE-409N');
    }
  )
);

test('el cliente no marca la ejecución → 403', async () => {
  const res = await request(app).post(`/solicitudes/${SOLICITUD}/iniciar`).set('Authorization', bearer('cliente'));
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'MANI-EJE-403');
});

test(
  'el cliente consulta las marcas (200)',
  withRepo({ consultar: async () => ({ solicitudId: SOLICITUD, estado: 'EN_EJECUCION', inicio: { registradoEn: '2026-10-27T15:00:00.000Z' }, fin: null }) }, async () => {
    const res = await request(app).get(`/solicitudes/${SOLICITUD}/ejecucion`).set('Authorization', bearer('cliente'));
    assert.equal(res.status, 200);
    assert.equal(res.body.ejecucion.estado, 'EN_EJECUCION');
    assert.equal(res.body.ejecucion.fin, null);
  })
);

test('las rutas de la 865 y la 867 siguen respondiendo (la de iniciar no las captura)', async () => {
  const res = await request(app).get(`/solicitudes/${SOLICITUD}/cotizaciones`);
  assert.equal(res.status, 401);
});
