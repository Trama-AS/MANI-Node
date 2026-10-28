const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');
const TransactionAuditUseCase = require('../../../src/application/useCases/audit/TransactionAuditUseCase');
const { NotFoundError } = require('../../../src/domain/errors/DomainError');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const PAGO = '33333333-3333-4333-8333-333333333333';

function bearer({ role = 'cliente' } = {}) {
  const token = jwt.sign({ sub: USER, app_metadata: { tenant_id: TENANT, user_role: role } }, config.supabaseJwtSecret, {
    algorithm: 'HS256',
    expiresIn: '1h',
  });
  return `Bearer ${token}`;
}

const evento = {
  id: '44444444-4444-4444-8444-444444444444', pagoId: PAGO, tipo: 'PAGO_REGISTRADO', estado: 'APROBADO', monto: 150000,
  moneda: 'COP', actor: { id: USER, rol: 'CLIENT' }, correlationId: 'corr-1', creadoEn: '2026-10-27T10:00:00.000Z',
};

// Sustituye el caso de uso del container por uno con repositorio falso y lo restaura al terminar.
function conAuditoria(repo, fn) {
  return async () => {
    const original = container.transactionAuditUseCase;
    const llamadas = [];
    container.transactionAuditUseCase = new TransactionAuditUseCase({
      auditRepository: {
        listarPorPago: async (ctx, datos) => (llamadas.push({ ctx, datos }), repo.listarPorPago ? repo.listarPorPago(ctx, datos) : { eventos: [evento] }),
        listar: async (ctx, datos) => (llamadas.push({ ctx, datos }), repo.listar ? repo.listar(ctx, datos) : { eventos: [evento] }),
      },
    });
    try {
      await fn(llamadas);
    } finally {
      container.transactionAuditUseCase = original;
    }
  };
}

test('sin Authorization ambas rutas responden 401', async () => {
  assert.equal((await request(app).get(`/api/v1/pagos/${PAGO}/eventos`)).status, 401);
  assert.equal((await request(app).get('/api/v1/auditoria/transacciones')).status, 401);
});

test('el cliente consulta los eventos de un pago; el tenant sale del JWT', conAuditoria({}, async (llamadas) => {
  const res = await request(app).get(`/api/v1/pagos/${PAGO}/eventos`).set('Authorization', bearer());

  assert.equal(res.status, 200);
  assert.equal(res.headers['cache-control'], 'no-store');
  assert.equal(res.body.eventos[0].tipo, 'PAGO_REGISTRADO');
  assert.ok(res.body.correlationId);
  assert.equal(llamadas[0].ctx.tenantId, TENANT);
  assert.equal(llamadas[0].ctx.role, 'CLIENT');
}));

test('C3: el aliado recibe 403 en ambas rutas y el cliente en el listado del tenant', conAuditoria({}, async (llamadas) => {
  assert.equal((await request(app).get(`/api/v1/pagos/${PAGO}/eventos`).set('Authorization', bearer({ role: 'aliado' }))).status, 403);
  assert.equal((await request(app).get('/api/v1/auditoria/transacciones').set('Authorization', bearer({ role: 'aliado' }))).status, 403);
  assert.equal((await request(app).get('/api/v1/auditoria/transacciones').set('Authorization', bearer())).status, 403);
  assert.equal(llamadas.length, 0);
}));

test('el administrador lista el registro del tenant con límite, cursor y filtro por pago', conAuditoria({}, async (llamadas) => {
  const res = await request(app)
    .get(`/api/v1/auditoria/transacciones?limite=20&despuesDe=${evento.id}&pagoId=${PAGO}`)
    .set('Authorization', bearer({ role: 'admin_tenant' }));

  assert.equal(res.status, 200);
  assert.deepEqual(llamadas[0].datos, { limite: 20, despuesDe: evento.id, pagoId: PAGO });
  assert.equal(llamadas[0].ctx.role, 'ADMIN');
}));

test('un pago ajeno responde 404 con MANI-AUD-404', conAuditoria({
  listarPorPago: async () => { throw new NotFoundError('MANI-AUD-404: pago no encontrado', 'MANI-AUD-404'); },
}, async () => {
  const res = await request(app).get(`/api/v1/pagos/${PAGO}/eventos`).set('Authorization', bearer());
  assert.equal(res.status, 404);
  assert.equal(res.body.code, 'MANI-AUD-404');
}));

test('parámetros inválidos responden 400', conAuditoria({}, async () => {
  assert.equal((await request(app).get('/api/v1/pagos/no-uuid/eventos').set('Authorization', bearer())).status, 400);
  assert.equal((await request(app).get('/api/v1/auditoria/transacciones?limite=500').set('Authorization', bearer({ role: 'admin_tenant' }))).status, 400);
}));

test('el registro es de solo lectura: POST, PUT, PATCH y DELETE no existen', async () => {
  for (const metodo of ['post', 'put', 'patch', 'delete']) {
    const res = await request(app)[metodo](`/api/v1/pagos/${PAGO}/eventos`).set('Authorization', bearer({ role: 'admin_tenant' })).send({});
    assert.ok([404, 405].includes(res.status), `${metodo} respondió ${res.status}`);
  }
});
