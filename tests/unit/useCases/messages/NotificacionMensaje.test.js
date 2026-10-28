const test = require('node:test');
const assert = require('node:assert/strict');
const MessagesUseCase = require('../../../../src/application/useCases/messages/MessagesUseCase');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SOLICITUD = '33333333-3333-4333-8333-333333333333';
const MENSAJE = '66666666-6666-4666-8666-666666666666';
const cliente = { tenantId: TENANT, userId: USER, role: 'CLIENT' };

function crear({ creado = true, notificador } = {}) {
  const eventos = [];
  const fake = notificador || { execute: async (ctx, e) => (eventos.push({ ctx, e }), { estado: 'SIMULADA' }) };
  const messageRepository = { enviar: async () => ({ mensaje: { id: MENSAJE, contenido: 'texto privado del mensaje' }, creado }) };
  return { uc: new MessagesUseCase({ messageRepository, notificador: fake }), eventos };
}
const enviar = (uc) => uc.enviar({ user: cliente, solicitudId: SOLICITUD, body: { contenido: 'texto privado del mensaje' }, correlationId: 'corr-9' });

test('C1: al guardarse un mensaje se notifica al otro participante, con remitente y servicio, sin el texto', async () => {
  const { uc, eventos } = crear();
  await enviar(uc);

  assert.equal(eventos.length, 1);
  assert.deepEqual(eventos[0].ctx, cliente);
  assert.deepEqual(eventos[0].e, {
    solicitudId: SOLICITUD, destino: 'CONTRARIO', tipo: 'MENSAJE_NUEVO', claveEvento: MENSAJE,
    payload: { mensajeId: MENSAJE, remitenteRol: 'CLIENT' }, correlationId: 'corr-9',
  });
  assert.equal(JSON.stringify(eventos[0].e).includes('texto privado'), false, 'el texto del mensaje nunca viaja en la notificación');
});

test('C2: un reintento con la misma clave (200) vuelve a pedir la notificación con la misma clave de evento', async () => {
  const { uc, eventos } = crear({ creado: false });
  const r = await enviar(uc);
  assert.equal(r.creado, false);
  assert.equal(eventos[0].e.claveEvento, MENSAJE, 'el notificador la descarta si ya se notificó');
});

test('C2: aunque el notificador falle, el mensaje queda guardado y se devuelve', async () => {
  const { uc } = crear({ notificador: { execute: async () => ({ estado: 'ERROR' }) } });
  const r = await enviar(uc);
  assert.equal(r.mensaje.id, MENSAJE);
});

test('C3: un rol que no participa no llega al notificador', async () => {
  const { uc, eventos } = crear();
  await assert.rejects(() => uc.enviar({ user: { ...cliente, role: 'ADMIN' }, solicitudId: SOLICITUD, body: { contenido: 'hola' } }), { code: 'MANI-MSG-403' });
  assert.equal(eventos.length, 0);
});

test('sin notificador la mensajería funciona igual', async () => {
  const messageRepository = { enviar: async () => ({ mensaje: { id: MENSAJE }, creado: true }) };
  const uc = new MessagesUseCase({ messageRepository });
  assert.equal((await enviar(uc)).creado, true);
});
