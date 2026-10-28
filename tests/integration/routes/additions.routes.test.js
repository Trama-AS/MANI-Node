const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');
const RequestAdditionUseCase = require('../../../src/application/useCases/additions/RequestAdditionUseCase');
const ListAdditionsUseCase = require('../../../src/application/useCases/additions/ListAdditionsUseCase');
const RespondAdditionUseCase = require('../../../src/application/useCases/additions/RespondAdditionUseCase');
const { ConflictError, ValidationError } = require('../../../src/domain/errors/DomainError');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';
const ADICION = '88888888-8888-4888-8888-888888888888';
const RESUMEN = { cotizacionId: 'cot-1', totalCotizacion: 1000, totalAdicionesAceptadas: 0, totalVigente: 1000, topeAdiciones: 500, disponibleParaAdiciones: 500 };

function bearer(role) {
  const token = jwt.sign({ sub: USER, app_metadata: { tenant_id: TENANT, user_role: role } }, config.supabaseJwtSecret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
  return `Bearer ${token}`;
}

// Reemplaza los tres casos de uso por unos con el repositorio dado y los restaura al terminar.
function withRepo(repo, fn) {
  return async () => {
    const originales = ['requestAdditionUseCase', 'listAdditionsUseCase', 'respondAdditionUseCase'].map((k) => [k, container[k]]);
    container.requestAdditionUseCase = new RequestAdditionUseCase({ additionRepository: repo });
    container.listAdditionsUseCase = new ListAdditionsUseCase({ additionRepository: repo });
    container.respondAdditionUseCase = new RespondAdditionUseCase({ additionRepository: repo });
    try {
      await fn();
    } finally {
      for (const [k, v] of originales) container[k] = v;
    }
  };
}

test('sin token → 401 en las cuatro rutas', async () => {
  for (const [metodo, ruta] of [
    ['post', `/api/v1/solicitudes/${SOLICITUD}/adiciones`],
    ['get', `/api/v1/solicitudes/${SOLICITUD}/adiciones`],
    ['post', `/api/v1/adiciones/${ADICION}/aceptar`],
    ['post', `/api/v1/adiciones/${ADICION}/rechazar`],
  ]) {
    const res = await request(app)[metodo](ruta);
    assert.equal(res.status, 401, ruta);
  }
});

test(
  'POST /solicitudes/:id/adiciones → 201 con la adición y el resumen; el tenant sale del token',
  withRepo(
    {
      solicitar: async (ctx, datos) => {
        assert.equal(ctx.tenantId, TENANT);
        assert.equal(ctx.role, 'ALLY');
        return { adicion: { id: ADICION, estado: 'PENDIENTE', total: datos.valorManoObra + datos.valorMateriales }, resumen: RESUMEN };
      },
    },
    async () => {
      const res = await request(app)
        .post(`/api/v1/solicitudes/${SOLICITUD}/adiciones`)
        .set('Authorization', bearer('aliado'))
        .set('X-Tenant-Id', '99999999-9999-4999-8999-999999999999')
        .send({ motivo: 'Tubería rota detrás del muro', valorManoObra: 100, valorMateriales: 50 });
      assert.equal(res.status, 201);
      assert.equal(res.body.adicion.total, 150);
      assert.deepEqual(res.body.resumen, RESUMEN);
      assert.ok(res.body.correlationId);
    }
  )
);

test(
  'GET /solicitudes/:id/adiciones → 200 con la lista y el total vigente',
  withRepo({ listarPorSolicitud: async () => ({ adiciones: [], resumen: RESUMEN }) }, async () => {
    const res = await request(app).get(`/api/v1/solicitudes/${SOLICITUD}/adiciones`).set('Authorization', bearer('cliente'));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.adiciones, []);
    assert.equal(res.body.resumen.totalVigente, 1000);
  })
);

test(
  'aceptar y rechazar envían su decisión → 200',
  withRepo(
    {
      responder: async (_ctx, datos) => ({ adicion: { id: ADICION, estado: datos.decision.adicion }, resumen: RESUMEN }),
    },
    async () => {
      for (const [ruta, estado] of [['aceptar', 'ACEPTADA'], ['rechazar', 'RECHAZADA']]) {
        const res = await request(app)
          .post(`/api/v1/adiciones/${ADICION}/${ruta}`)
          .set('Authorization', bearer('cliente'))
          .send({ comentario: 'ok' });
        assert.equal(res.status, 200, ruta);
        assert.equal(res.body.adicion.estado, estado);
      }
    }
  )
);

test(
  'los errores de dominio salen con su código: 409P, 400T y 403 de rol',
  withRepo(
    {
      solicitar: async () => {
        throw new ConflictError('MANI-ADI-409P: ya hay una adición pendiente de decisión del cliente', 'MANI-ADI-409P');
      },
      responder: async () => {
        throw new ValidationError('MANI-ADI-400T: la adición supera el tope', 'MANI-ADI-400T');
      },
    },
    async () => {
      const pendiente = await request(app)
        .post(`/api/v1/solicitudes/${SOLICITUD}/adiciones`)
        .set('Authorization', bearer('aliado'))
        .send({ motivo: 'Tubería rota detrás del muro', valorManoObra: 100, valorMateriales: 0 });
      assert.equal(pendiente.status, 409);
      assert.equal(pendiente.body.code, 'MANI-ADI-409P');

      const tope = await request(app).post(`/api/v1/adiciones/${ADICION}/aceptar`).set('Authorization', bearer('cliente'));
      assert.equal(tope.status, 400);
      assert.equal(tope.body.code, 'MANI-ADI-400T');

      const rol = await request(app).post(`/api/v1/adiciones/${ADICION}/aceptar`).set('Authorization', bearer('aliado'));
      assert.equal(rol.status, 403);
      assert.equal(rol.body.code, 'MANI-ADI-403');
    }
  )
);
