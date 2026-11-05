const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');
const CreateQuoteUseCase = require('../../../src/application/useCases/quotes/CreateQuoteUseCase');
const ListQuotesUseCase = require('../../../src/application/useCases/quotes/ListQuotesUseCase');
const { ConflictError, NotFoundError } = require('../../../src/domain/errors/DomainError');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';
const RUTA = `/solicitudes/${SOLICITUD}/cotizaciones`;

function bearer(role) {
  const token = jwt.sign({ sub: USER, app_metadata: { tenant_id: TENANT, user_role: role } }, config.supabaseJwtSecret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
  return `Bearer ${token}`;
}

// Sustituye los casos de uso del container por dobles con un repositorio falso y los restaura al terminar.
function withRepo(repo, fn) {
  return async () => {
    const original = { create: container.createQuoteUseCase, list: container.listQuotesUseCase };
    container.createQuoteUseCase = new CreateQuoteUseCase({ quoteRepository: repo });
    container.listQuotesUseCase = new ListQuotesUseCase({ quoteRepository: repo });
    try {
      await fn();
    } finally {
      container.createQuoteUseCase = original.create;
      container.listQuotesUseCase = original.list;
    }
  };
}

const cotizacion = { id: 'cot-1', version: 1, estado: 'PENDIENTE', valorManoObra: 100, valorMateriales: 50, total: 150 };

test('sin token → 401', async () => {
  const res = await request(app).post(RUTA).send({ valorManoObra: 100, valorMateriales: 50 });
  assert.equal(res.status, 401);
});

test(
  'POST: el aliado emite la cotización (201) con el tenant del token, aunque envíe otro en cabecera o cuerpo',
  withRepo(
    {
      emitir: async (ctx, datos) => {
        assert.equal(ctx.tenantId, TENANT);
        assert.equal(ctx.role, 'ALLY');
        assert.deepEqual(datos, { solicitudId: SOLICITUD, valorManoObra: 100, valorMateriales: 50 });
        return cotizacion;
      },
    },
    async () => {
      const res = await request(app)
        .post(RUTA)
        .set('Authorization', bearer('aliado'))
        .set('X-Tenant-Id', '99999999-9999-4999-8999-999999999999')
        .send({ valorManoObra: 100, valorMateriales: 50, tenantId: 'otro' });
      assert.equal(res.status, 201);
      assert.deepEqual(res.body.cotizacion, cotizacion);
    }
  )
);

test('POST: importe inválido → 400 MANI-COT-400', async () => {
  const res = await request(app).post(RUTA).set('Authorization', bearer('aliado')).send({ valorManoObra: -5, valorMateriales: 0 });
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'MANI-COT-400');
});

test('POST: el cliente no cotiza → 403 MANI-COT-403', async () => {
  const res = await request(app).post(RUTA).set('Authorization', bearer('cliente')).send({ valorManoObra: 1, valorMateriales: 0 });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'MANI-COT-403');
});

test(
  'POST: estado incompatible → 409 con el código del repositorio',
  withRepo(
    {
      emitir: async () => {
        throw new ConflictError('MANI-COT-409E: la solicitud en estado FINALIZADA no admite cotización', 'MANI-COT-409E');
      },
    },
    async () => {
      const res = await request(app).post(RUTA).set('Authorization', bearer('aliado')).send({ valorManoObra: 1, valorMateriales: 0 });
      assert.equal(res.status, 409);
      assert.equal(res.body.code, 'MANI-COT-409E');
    }
  )
);

test(
  'GET: el cliente dueño consulta las versiones (200)',
  withRepo({ listarPorSolicitud: async (ctx) => (ctx.role === 'CLIENT' ? [cotizacion] : []) }, async () => {
    const res = await request(app).get(RUTA).set('Authorization', bearer('cliente'));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.cotizaciones, [cotizacion]);
  })
);

test(
  'GET: solicitud ajena → 404 MANI-COT-404',
  withRepo(
    {
      listarPorSolicitud: async () => {
        throw new NotFoundError('MANI-COT-404: solicitud no encontrada', 'MANI-COT-404');
      },
    },
    async () => {
      const res = await request(app).get(RUTA).set('Authorization', bearer('cliente'));
      assert.equal(res.status, 404);
      assert.equal(res.body.code, 'MANI-COT-404');
    }
  )
);

test('GET: id que no es UUID → 400', async () => {
  const res = await request(app).get('/solicitudes/abc/cotizaciones').set('Authorization', bearer('aliado'));
  assert.equal(res.status, 400);
  assert.equal(res.body.code, 'MANI-COT-400');
});
