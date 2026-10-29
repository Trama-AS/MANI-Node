const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');
const GetRequestFormOptionsUseCase = require('../../../src/application/useCases/requests/GetRequestFormOptionsUseCase');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

function bearer(role) {
  const token = jwt.sign({ sub: USER, app_metadata: { tenant_id: TENANT, user_role: role } }, config.supabaseJwtSecret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
  return `Bearer ${token}`;
}

// Sustituye el caso de uso por uno con repositorio falso y lo restaura al terminar.
function withRepo(repo, fn) {
  return async () => {
    const original = container.getRequestFormOptionsUseCase;
    container.getRequestFormOptionsUseCase = new GetRequestFormOptionsUseCase({ requestFormRepository: repo });
    try {
      await fn();
    } finally {
      container.getRequestFormOptionsUseCase = original;
    }
  };
}

const repo = {
  listarCategorias: async (ctx) => {
    assert.equal(ctx.tenantId, TENANT);
    return [{ id: 'c1', nombre: 'Plomería', flujoOperativo: 'COTIZACION_PREVIA' }];
  },
  listarSitios: async () => [{ id: 's1', nombre: 'Sede', direccion: 'Calle 1 # 2-3', zonaId: 'z1', zona: 'Chapinero', zonaPadre: 'Bogotá' }],
};

test('sin token → 401', async () => {
  for (const ruta of ['/solicitudes/categorias', '/solicitudes/sitios']) {
    const res = await request(app).get(ruta);
    assert.equal(res.status, 401);
  }
});

test(
  'el cliente lee categorías y sitios (200), con el tenant del token aunque envíe otro en cabecera',
  withRepo(repo, async () => {
    const cat = await request(app)
      .get('/api/v1/solicitudes/categorias')
      .set('Authorization', bearer('cliente'))
      .set('X-Tenant-Id', '99999999-9999-4999-8999-999999999999');
    assert.equal(cat.status, 200);
    assert.equal(cat.body.categorias[0].flujoOperativo, 'COTIZACION_PREVIA');

    const sit = await request(app).get('/solicitudes/sitios').set('Authorization', bearer('cliente'));
    assert.equal(sit.status, 200);
    assert.equal(sit.body.sitios[0].zonaPadre, 'Bogotá');
  })
);

test('aliado → 403 MANI-SOL-403C', async () => {
  const res = await request(app).get('/solicitudes/sitios').set('Authorization', bearer('aliado'));
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'MANI-SOL-403C');
});
