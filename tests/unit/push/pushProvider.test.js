const test = require('node:test');
const assert = require('node:assert/strict');
const MockPushProvider = require('../../../src/infrastructure/push/MockPushProvider');
const { createPushProvider, PushProviderConfigurationError } = require('../../../src/infrastructure/push/createPushProvider');

const TENANT = '11111111-1111-4111-8111-111111111111';

test('mock: responde como un proveedor que aceptó el mensaje, marcado como simulado', async () => {
  const provider = new MockPushProvider({ idFactory: () => 'abc' });

  const result = await provider.send({ notificacionId: 'n1', tenantId: TENANT, usuarioId: 'u1', tipo: 'OFERTA_DESPACHO', payload: { a: 1 } });

  assert.deepEqual(result, { proveedor: 'mock', estado: 'SIMULADA', simulada: true, mensajeId: 'mock-abc' });
  assert.equal(provider.name, 'mock');
});

test('mock: guarda lo enviado por usuario y tenant, del más reciente al más antiguo', async () => {
  const provider = new MockPushProvider();
  await provider.send({ notificacionId: 'n1', tenantId: TENANT, usuarioId: 'u1', tipo: 'T', payload: {} });
  await provider.send({ notificacionId: 'n2', tenantId: TENANT, usuarioId: 'u2', tipo: 'T', payload: {} });
  await provider.send({ notificacionId: 'n3', tenantId: TENANT, usuarioId: 'u1', tipo: 'T', payload: {} });
  await provider.send({ notificacionId: 'n4', tenantId: 'otro', usuarioId: 'u1', tipo: 'T', payload: {} });

  assert.deepEqual(provider.sentTo(TENANT, 'u1').map((m) => m.notificacionId), ['n3', 'n1']);
});

test('mock: conserva como máximo maxSent mensajes en memoria', async () => {
  const provider = new MockPushProvider({ maxSent: 2 });
  for (const id of ['n1', 'n2', 'n3']) {
    await provider.send({ notificacionId: id, tenantId: TENANT, usuarioId: 'u1', tipo: 'T', payload: {} });
  }
  assert.deepEqual(provider.sent.map((m) => m.notificacionId), ['n2', 'n3']);
});

test('createPushProvider: por omisión y con "mock" (sin importar mayúsculas) usa el mock', () => {
  assert.ok(createPushProvider() instanceof MockPushProvider);
  assert.ok(createPushProvider(' MOCK ') instanceof MockPushProvider);
});

test('createPushProvider: un proveedor sin adaptador detiene el arranque con un error explícito', () => {
  assert.throws(() => createPushProvider('fcm'), (err) => err instanceof PushProviderConfigurationError && /PUSH_PROVIDER="fcm"/.test(err.message));
});
