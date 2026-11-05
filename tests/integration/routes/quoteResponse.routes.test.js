const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');
const RespondQuoteUseCase = require('../../../src/application/useCases/quotes/RespondQuoteUseCase');
const { ConflictError } = require('../../../src/domain/errors/DomainError');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const COTIZACION = '77777777-7777-4777-8777-777777777777';

function bearer(role) {
  const token = jwt.sign({ sub: USER, app_metadata: { tenant_id: TENANT, user_role: role } }, config.supabaseJwtSecret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
  return `Bearer ${token}`;
}

function withRepo(repo, fn) {
  return async () => {
    const original = container.respondQuoteUseCase;
    container.respondQuoteUseCase = new RespondQuoteUseCase({ quoteRepository: repo });
    try {
      await fn();
    } finally {
      container.respondQuoteUseCase = original;
    }
  };
}

test('sin token → 401', async () => {
  const res = await request(app).post(`/cotizaciones/${COTIZACION}/aceptar`);
  assert.equal(res.status, 401);
});

test(
  'cada ruta envía su decisión con el tenant del token (200)',
  withRepo(
    {
      responder: async (ctx, datos) => {
        assert.equal(ctx.tenantId, TENANT);
        return { cotizacion: { id: COTIZACION, estado: datos.decision.cotizacion }, solicitud: { estado: datos.decision.solicitud } };
      },
    },
    async () => {
      for (const [ruta, body, estado] of [
        ['aceptar', {}, 'ACEPTADA'],
        ['rechazar', { motivo: 'Muy costosa' }, 'RECHAZADA'],
        ['ajustar', { comentario: 'Bajar materiales' }, 'AJUSTE_SOLICITADO'],
      ]) {
        const res = await request(app)
          .post(`/api/v1/cotizaciones/${COTIZACION}/${ruta}`)
          .set('Authorization', bearer('cliente'))
          .set('X-Tenant-Id', '99999999-9999-4999-8999-999999999999')
          .send(body);
        assert.equal(res.status, 200, ruta);
        assert.equal(res.body.cotizacion.estado, estado);
      }
    }
  )
);

test('rechazar sin motivo → 400 MANI-COT-400', async () => {
  const res = await request(app).post(`/cotizaciones/${COTIZACION}/rechazar`).set('Authorization', bearer('cliente')).send({});
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'MANI-COT-400');
});

test('el aliado no responde la cotización → 403', async () => {
  const res = await request(app).post(`/cotizaciones/${COTIZACION}/aceptar`).set('Authorization', bearer('aliado'));
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'MANI-COT-403');
});

test(
  'una cotización ya respondida → 409 MANI-COT-409R',
  withRepo(
    {
      responder: async () => {
        throw new ConflictError('MANI-COT-409R: la cotización ya fue respondida (estado ACEPTADA)', 'MANI-COT-409R');
      },
    },
    async () => {
      const res = await request(app).post(`/cotizaciones/${COTIZACION}/aceptar`).set('Authorization', bearer('cliente'));
      assert.equal(res.status, 409);
      assert.equal(res.body.code, 'MANI-COT-409R');
    }
  )
);
