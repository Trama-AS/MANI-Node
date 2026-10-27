const test = require('node:test');
const assert = require('node:assert/strict');
const MessagesUseCase = require('../../../../src/application/useCases/messages/MessagesUseCase');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SOLICITUD = '33333333-3333-4333-8333-333333333333';
const CLAVE = '44444444-4444-4444-8444-444444444444';
const cliente = { tenantId: TENANT, userId: USER, role: 'CLIENT' };

function crear() {
  const llamadas = { enviar: [], listar: [] };
  const messageRepository = {
    enviar: async (ctx, datos) => (llamadas.enviar.push({ ctx, datos }), { mensaje: { id: 'm1' }, creado: true }),
    listar: async (ctx, datos) => (llamadas.listar.push({ ctx, datos }), { mensajes: [] }),
  };
  return { uc: new MessagesUseCase({ messageRepository }), llamadas };
}

const codigo = (c, status) => (err) => err.code === c && (status === undefined || err.statusCode === status);

test('enviar: recorta el texto y usa tenant, usuario y rol de la sesión, nunca del cuerpo', async () => {
  const { uc, llamadas } = crear();
  await uc.enviar({ user: cliente, solicitudId: SOLICITUD, body: { contenido: '  hola  ', claveIdempotencia: CLAVE, remitenteId: 'x', tenantId: 'y' } });

  assert.deepEqual(llamadas.enviar[0].ctx, cliente);
  assert.deepEqual(llamadas.enviar[0].datos, { solicitudId: SOLICITUD, contenido: 'hola', claveIdempotencia: CLAVE });
});

test('enviar: la clave de idempotencia es opcional', async () => {
  const { uc, llamadas } = crear();
  await uc.enviar({ user: { ...cliente, role: 'ALLY' }, solicitudId: SOLICITUD, body: { contenido: 'ok' } });
  assert.equal(llamadas.enviar[0].datos.claveIdempotencia, null);
});

for (const [nombre, body] of [
  ['sin contenido', {}],
  ['contenido que no es texto', { contenido: 5 }],
  ['solo espacios', { contenido: '   ' }],
  ['más de 1000 caracteres', { contenido: 'a'.repeat(1001) }],
  ['con carácter NUL', { contenido: 'ho\u0000la' }],
  ['clave de idempotencia que no es UUID', { contenido: 'hola', claveIdempotencia: 'abc' }],
]) {
  test(`enviar: rechaza ${nombre} con 400 sin tocar el repositorio`, async () => {
    const { uc, llamadas } = crear();
    await assert.rejects(() => uc.enviar({ user: cliente, solicitudId: SOLICITUD, body }), codigo('MANI-MSG-400', 400));
    assert.equal(llamadas.enviar.length, 0);
  });
}

test('enviar: acepta exactamente 1000 caracteres', async () => {
  const { uc } = crear();
  await uc.enviar({ user: cliente, solicitudId: SOLICITUD, body: { contenido: 'a'.repeat(1000) } });
});

test('enviar: id de solicitud inválido responde 400', async () => {
  const { uc } = crear();
  await assert.rejects(() => uc.enviar({ user: cliente, solicitudId: 'no-uuid', body: { contenido: 'hola' } }), codigo('MANI-MSG-400', 400));
});

test('sin sesión responde 401 y los roles que no participan reciben 403', async () => {
  const { uc, llamadas } = crear();
  await assert.rejects(() => uc.enviar({ user: null, solicitudId: SOLICITUD, body: { contenido: 'x' } }), codigo('MANI-MSG-401', 401));
  await assert.rejects(() => uc.listar({ user: { ...cliente, userId: 'no-uuid' }, solicitudId: SOLICITUD }), codigo('MANI-MSG-401', 401));
  for (const role of ['ADMIN', 'PLATFORM_ADMIN', undefined]) {
    await assert.rejects(() => uc.enviar({ user: { ...cliente, role }, solicitudId: SOLICITUD, body: { contenido: 'x' } }), codigo('MANI-MSG-403', 403));
    await assert.rejects(() => uc.listar({ user: { ...cliente, role }, solicitudId: SOLICITUD }), codigo('MANI-MSG-403', 403));
  }
  assert.equal(llamadas.enviar.length + llamadas.listar.length, 0);
});

test('listar: límite por omisión de 50 y cursor opcional', async () => {
  const { uc, llamadas } = crear();
  await uc.listar({ user: cliente, solicitudId: SOLICITUD });
  await uc.listar({ user: cliente, solicitudId: SOLICITUD, query: { despuesDe: CLAVE, limite: '100' } });

  assert.deepEqual(llamadas.listar[0].datos, { solicitudId: SOLICITUD, despuesDe: null, limite: 50 });
  assert.deepEqual(llamadas.listar[1].datos, { solicitudId: SOLICITUD, despuesDe: CLAVE, limite: 100 });
});

for (const query of [{ limite: '0' }, { limite: '101' }, { limite: 'abc' }, { limite: '1.5' }, { despuesDe: 'no-uuid' }]) {
  test(`listar: rechaza ${JSON.stringify(query)} con 400`, async () => {
    const { uc } = crear();
    await assert.rejects(() => uc.listar({ user: cliente, solicitudId: SOLICITUD, query }), codigo('MANI-MSG-400', 400));
  });
}
