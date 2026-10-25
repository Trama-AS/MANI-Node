const test = require('node:test');
const assert = require('node:assert/strict');
const ListMyInboxUseCase = require('../../../../src/application/useCases/notifications/ListMyInboxUseCase');
const MockPushProvider = require('../../../../src/infrastructure/push/MockPushProvider');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '77777777-7777-4777-8777-777777777777';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';

function makeUseCase(rows = [], pushProvider = new MockPushProvider()) {
  const calls = [];
  const useCase = new ListMyInboxUseCase({
    notificacionRepository: {
      listForUser: async (...args) => {
        calls.push(args);
        return rows;
      },
    },
    pushProvider,
  });
  return { useCase, calls };
}

test('bandeja: lee solo la del usuario y tenant de la sesión y marca que la entrega es simulada', async () => {
  const sent = new Date('2026-10-25T10:00:00Z');
  const { useCase, calls } = makeUseCase([
    { id: 'n1', tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload: { requestId: SOLICITUD }, enviadoAt: sent, leidoAt: null },
  ]);

  const inbox = await useCase.execute({ session: { userId: USER, tenantId: TENANT, role: 'ALLY' }, query: { userId: 'otro' } });

  assert.deepEqual(calls[0], [TENANT, USER, { limit: 50 }]);
  assert.deepEqual(inbox, {
    proveedor: 'mock',
    simulada: true,
    items: [
      { id: 'n1', tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload: { requestId: SOLICITUD }, enviadoAt: sent.toISOString(), leidoAt: null },
    ],
  });
});

test('bandeja: cualquier rol con sesión puede leer la suya', async () => {
  for (const role of ['CLIENT', 'ALLY', 'ADMIN']) {
    const { useCase } = makeUseCase();
    const inbox = await useCase.execute({ session: { userId: USER, tenantId: TENANT, role } });
    assert.deepEqual(inbox.items, []);
  }
});

test('bandeja: acepta limit entre 1 y 100', async () => {
  const { useCase, calls } = makeUseCase();
  await useCase.execute({ session: { userId: USER, tenantId: TENANT }, query: { limit: '10' } });
  assert.deepEqual(calls[0][2], { limit: 10 });

  for (const limit of ['0', '101', 'abc', '2.5']) {
    await assert.rejects(
      () => useCase.execute({ session: { userId: USER, tenantId: TENANT }, query: { limit } }),
      (err) => err.statusCode === 400 && err.code === 'MANI-NOT-400'
    );
  }
});

test('bandeja: sin usuario UUID o sin tenant en la sesión responde 401 y no consulta', async () => {
  const { useCase, calls } = makeUseCase();
  for (const session of [{}, { userId: USER }, { tenantId: TENANT, userId: 'user-1' }]) {
    await assert.rejects(() => useCase.execute({ session }), (err) => err.statusCode === 401);
  }
  assert.equal(calls.length, 0);
});

test('bandeja: con un proveedor real no se marca como simulada', async () => {
  const { useCase } = makeUseCase([], { name: 'fcm', send: async () => ({}) });
  const inbox = await useCase.execute({ session: { userId: USER, tenantId: TENANT } });
  assert.equal(inbox.simulada, false);
  assert.equal(inbox.proveedor, 'fcm');
});

test('bandeja: exige repositorio y proveedor', () => {
  assert.throws(() => new ListMyInboxUseCase({ pushProvider: {} }), /notificacionRepository/);
  assert.throws(() => new ListMyInboxUseCase({ notificacionRepository: {} }), /pushProvider/);
});
