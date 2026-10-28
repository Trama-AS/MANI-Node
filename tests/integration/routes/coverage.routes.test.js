const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');
const GetAllyCoverageUseCase = require('../../../src/application/useCases/profiles/GetAllyCoverageUseCase');
const DeclareAllyCoverageUseCase = require('../../../src/application/useCases/profiles/DeclareAllyCoverageUseCase');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const Z1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ZONA = { id: Z1, name: 'Chapinero', level: 'LOCALIDAD', parentId: null, active: true };

const bearer = (role) =>
  `Bearer ${jwt.sign({ sub: USER, app_metadata: { tenant_id: TENANT, user_role: role } }, config.supabaseJwtSecret, { algorithm: 'HS256', expiresIn: '1h' })}`;

// Reemplaza los casos de uso por unos con el repositorio dado y los restaura al terminar.
function withRepo(repo, fn) {
  return async () => {
    const originales = ['getAllyCoverageUseCase', 'declareAllyCoverageUseCase'].map((k) => [k, container[k]]);
    container.getAllyCoverageUseCase = new GetAllyCoverageUseCase({ coberturaRepository: repo });
    container.declareAllyCoverageUseCase = new DeclareAllyCoverageUseCase({ coberturaRepository: repo });
    try {
      await fn();
    } finally {
      for (const [k, v] of originales) container[k] = v;
    }
  };
}

test('sin token → 401 en GET y PUT', async () => {
  assert.equal((await request(app).get('/api/v1/profiles/me/coverage')).status, 401);
  assert.equal((await request(app).put('/api/v1/profiles/me/coverage').send({ zoneIds: [Z1] })).status, 401);
});

test(
  'GET /profiles/me/coverage → 200 con el tenant, usuario y rol del token',
  withRepo(
    {
      obtener: async (ctx) => {
        assert.deepEqual(ctx, { tenantId: TENANT, userId: USER, role: 'ALLY' });
        return [ZONA];
      },
    },
    async () => {
      const res = await request(app).get('/api/v1/profiles/me/coverage').set('Authorization', bearer('aliado'));
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.zoneIds, [Z1]);
      assert.deepEqual(res.body.zones, [ZONA]);
    }
  )
);

test(
  'PUT /profiles/me/coverage → 200; un tenant_id o aliado_id en el cuerpo se ignora',
  withRepo(
    {
      declarar: async (ctx, ids) => {
        assert.deepEqual(ctx, { tenantId: TENANT, userId: USER, role: 'ALLY' });
        assert.deepEqual(ids, [Z1]);
        return [ZONA];
      },
    },
    async () => {
      const res = await request(app)
        .put('/api/v1/profiles/me/coverage')
        .set('Authorization', bearer('aliado'))
        .send({ zoneIds: [Z1], tenantId: 'otro', aliadoId: 'otro' });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.zoneIds, [Z1]);
    }
  )
);

test(
  'PUT con cliente → 403; selección vacía → 422V; zona inválida (repositorio) → 422Z',
  withRepo(
    {
      declarar: async () => {
        const { DomainError } = require('../../../src/domain/errors/DomainError');
        throw new DomainError('MANI-COB-422Z: una o más zonas no están disponibles', 'MANI-COB-422Z', 422);
      },
    },
    async () => {
      const cliente = await request(app).put('/api/v1/profiles/me/coverage').set('Authorization', bearer('cliente')).send({ zoneIds: [Z1] });
      assert.equal(cliente.status, 403);
      assert.equal(cliente.body.code, 'MANI-COB-403');
      const vacio = await request(app).put('/api/v1/profiles/me/coverage').set('Authorization', bearer('aliado')).send({ zoneIds: [] });
      assert.equal(vacio.status, 422);
      assert.equal(vacio.body.code, 'MANI-COB-422V');
      const mala = await request(app).put('/api/v1/profiles/me/coverage').set('Authorization', bearer('aliado')).send({ zoneIds: [Z1] });
      assert.equal(mala.status, 422);
      assert.equal(mala.body.code, 'MANI-COB-422Z');
    }
  )
);
