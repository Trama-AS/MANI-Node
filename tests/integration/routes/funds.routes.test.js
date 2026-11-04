const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');
const FundsUseCase = require('../../../src/application/useCases/payments/FundsUseCase');
const { NotFoundError } = require('../../../src/domain/errors/DomainError');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const PAGO = '33333333-3333-4333-8333-333333333333';
const bearer = (role) =>
  `Bearer ${jwt.sign({ sub: USER, app_metadata: { tenant_id: TENANT, user_role: role } }, config.supabaseJwtSecret, { algorithm: 'HS256', expiresIn: '1h' })}`;

// SCRUM-891 a 894: sustituye el repositorio de fondos y restaura el caso de uso al terminar.
function withRepo(repo, fn) {
  return async () => {
    const original = container.fundsUseCase;
    container.fundsUseCase = new FundsUseCase({ fondosRepository: repo });
    try {
      await fn();
    } finally {
      container.fundsUseCase = original;
    }
  };
}

test('sin token → 401 en las cuatro rutas', async () => {
  for (const [metodo, ruta] of [
    ['get', `/api/v1/pagos/${PAGO}/retencion`],
    ['get', '/api/v1/pagos/aliado'],
    ['get', '/api/v1/pagos/comision'],
    ['put', '/api/v1/pagos/comision'],
  ]) {
    assert.equal((await request(app)[metodo](ruta)).status, 401, ruta);
  }
});

test(
  'GET /pagos/:id/retencion → 200 para el cliente; un pago ajeno o sin retención → 404',
  withRepo(
    {
      retencionDelPago: async (ctx, id) => {
        assert.deepEqual(ctx, { tenantId: TENANT, userId: USER, role: 'CLIENT' });
        if (id !== PAGO) throw new NotFoundError('MANI-FON-404: retención no encontrada', 'MANI-FON-404');
        return { id: 'r1', pagoId: PAGO, estado: 'RETENIDA', monto: 100, moneda: 'COP', simulada: true };
      },
    },
    async () => {
      const ok = await request(app).get(`/api/v1/pagos/${PAGO}/retencion`).set('Authorization', bearer('cliente'));
      assert.equal(ok.status, 200);
      assert.equal(ok.body.retencion.estado, 'RETENIDA');
      assert.equal(ok.body.retencion.simulada, true);
      const otro = await request(app).get(`/api/v1/pagos/${USER}/retencion`).set('Authorization', bearer('cliente'));
      assert.equal(otro.status, 404);
      assert.equal(otro.body.code, 'MANI-FON-404');
      assert.equal((await request(app).get(`/api/v1/pagos/${PAGO}/retencion`).set('Authorization', bearer('aliado'))).status, 403);
    }
  )
);

test(
  'GET /pagos/aliado → 200 con los cobros del aliado y sin colisionar con /pagos/:id; el cliente recibe 403',
  withRepo(
    {
      cobrosDelAliado: async (ctx) => {
        assert.deepEqual(ctx, { tenantId: TENANT, userId: USER, role: 'ALLY' });
        return [];
      },
    },
    async () => {
      const ok = await request(app).get('/api/v1/pagos/aliado').set('Authorization', bearer('aliado'));
      assert.equal(ok.status, 200);
      assert.deepEqual(ok.body.cobros, []);
      assert.equal(ok.body.simulado, true);
      const cliente = await request(app).get('/api/v1/pagos/aliado').set('Authorization', bearer('cliente'));
      assert.equal(cliente.status, 403);
    }
  )
);

test(
  'GET y PUT /pagos/comision: el administrador la lee y la fija; un valor inválido → 422; cliente y aliado → 403',
  withRepo(
    {
      obtenerComision: async () => ({ porcentaje: 10, porDefecto: true }),
      fijarComision: async (ctx, porcentaje) => {
        assert.equal(ctx.tenantId, TENANT);
        return { porcentaje, porDefecto: false };
      },
    },
    async () => {
      const get = await request(app).get('/api/v1/pagos/comision').set('Authorization', bearer('admin_tenant'));
      assert.equal(get.status, 200);
      assert.deepEqual(get.body.comision, { porcentaje: 10, porDefecto: true });
      const put = await request(app).put('/api/v1/pagos/comision').set('Authorization', bearer('admin_tenant')).send({ porcentaje: 15, tenantId: 'otro' });
      assert.equal(put.status, 200);
      assert.equal(put.body.comision.porcentaje, 15);
      const mala = await request(app).put('/api/v1/pagos/comision').set('Authorization', bearer('admin_tenant')).send({ porcentaje: 101 });
      assert.equal(mala.status, 422);
      assert.equal(mala.body.code, 'MANI-FON-422');
      for (const rol of ['cliente', 'aliado']) {
        assert.equal((await request(app).put('/api/v1/pagos/comision').set('Authorization', bearer(rol)).send({ porcentaje: 1 })).status, 403, rol);
      }
    }
  )
);
