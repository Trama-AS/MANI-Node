const test = require('node:test');
const assert = require('node:assert/strict');
const TransactionAuditUseCase = require('../../../../src/application/useCases/audit/TransactionAuditUseCase');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const PAGO = '33333333-3333-4333-8333-333333333333';
const EVENTO = '44444444-4444-4444-8444-444444444444';
const sesion = (role) => ({ tenantId: TENANT, userId: USER, role });

function crear() {
  const llamadas = { porPago: [], listar: [] };
  const auditRepository = {
    listarPorPago: async (ctx, datos) => (llamadas.porPago.push({ ctx, datos }), { eventos: [] }),
    listar: async (ctx, datos) => (llamadas.listar.push({ ctx, datos }), { eventos: [] }),
  };
  return { uc: new TransactionAuditUseCase({ auditRepository }), llamadas };
}

const codigo = (c, status) => (err) => err.code === c && err.statusCode === status;

test('porPago: el cliente y el administrador consultan; el contexto sale de la sesión', async () => {
  const { uc, llamadas } = crear();
  await uc.porPago({ user: sesion('CLIENT'), pagoId: PAGO });
  await uc.porPago({ user: sesion('ADMIN_TENANT'), pagoId: PAGO });

  assert.deepEqual(llamadas.porPago[0], { ctx: sesion('CLIENT'), datos: { pagoId: PAGO } });
  assert.equal(llamadas.porPago[1].ctx.role, 'ADMIN', 'ADMIN_TENANT se normaliza a ADMIN');
});

test('C3: el aliado, la plataforma o un rol ausente no consultan ni por pago ni el listado', async () => {
  const { uc, llamadas } = crear();
  for (const role of ['ALLY', 'PLATFORM_ADMIN', undefined]) {
    await assert.rejects(() => uc.porPago({ user: sesion(role), pagoId: PAGO }), codigo('MANI-AUD-403', 403));
    await assert.rejects(() => uc.listar({ user: sesion(role) }), codigo('MANI-AUD-403', 403));
  }
  assert.equal(llamadas.porPago.length + llamadas.listar.length, 0);
});

test('C3: el listado del tenant es solo del administrador; el cliente recibe 403', async () => {
  const { uc } = crear();
  await assert.rejects(() => uc.listar({ user: sesion('CLIENT') }), codigo('MANI-AUD-403', 403));
});

test('sin sesión o con usuario inválido responde 401', async () => {
  const { uc } = crear();
  await assert.rejects(() => uc.listar({ user: null }), codigo('MANI-AUD-401', 401));
  await assert.rejects(() => uc.porPago({ user: { ...sesion('CLIENT'), userId: 'no-uuid' }, pagoId: PAGO }), codigo('MANI-AUD-401', 401));
  await assert.rejects(() => uc.listar({ user: { role: 'ADMIN', userId: USER } }), codigo('MANI-AUD-401', 401));
});

test('listar: límite por omisión de 50 y filtros opcionales', async () => {
  const { uc, llamadas } = crear();
  await uc.listar({ user: sesion('ADMIN') });
  await uc.listar({ user: sesion('ADMIN'), query: { limite: '100', despuesDe: EVENTO, pagoId: PAGO } });

  assert.deepEqual(llamadas.listar[0].datos, { limite: 50, despuesDe: null, pagoId: null });
  assert.deepEqual(llamadas.listar[1].datos, { limite: 100, despuesDe: EVENTO, pagoId: PAGO });
});

for (const query of [{ limite: '0' }, { limite: '101' }, { limite: 'abc' }, { limite: '2.5' }, { despuesDe: 'x' }, { pagoId: 'x' }]) {
  test(`listar: rechaza ${JSON.stringify(query)} con 400`, async () => {
    const { uc, llamadas } = crear();
    await assert.rejects(() => uc.listar({ user: sesion('ADMIN'), query }), codigo('MANI-AUD-400', 400));
    assert.equal(llamadas.listar.length, 0);
  });
}

test('porPago: un id de pago inválido responde 400', async () => {
  const { uc } = crear();
  await assert.rejects(() => uc.porPago({ user: sesion('CLIENT'), pagoId: 'no-uuid' }), codigo('MANI-AUD-400', 400));
});

test('el constructor exige el repositorio', () => {
  assert.throws(() => new TransactionAuditUseCase({}), /auditRepository/);
});
