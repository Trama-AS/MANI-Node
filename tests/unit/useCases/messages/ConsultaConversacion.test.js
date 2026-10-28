const test = require('node:test');
const assert = require('node:assert/strict');
const MessagesUseCase = require('../../../../src/application/useCases/messages/MessagesUseCase');
const IMessageRepository = require('../../../../src/domain/ports/IMessageRepository');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SOLICITUD = '33333333-3333-4333-8333-333333333333';
const CURSOR = '44444444-4444-4444-8444-444444444444';
const admin = { tenantId: TENANT, userId: USER, role: 'ADMIN' };

function crear() {
  const llamadas = { consultar: [], listar: [] };
  const messageRepository = {
    consultarConversacion: async (ctx, datos) => (llamadas.consultar.push({ ctx, datos }), { consulta: { id: 'c1' }, mensajes: [] }),
    listarConsultas: async (ctx, datos) => (llamadas.listar.push({ ctx, datos }), { consultas: [] }),
  };
  return { uc: new MessagesUseCase({ messageRepository }), llamadas };
}

const codigo = (c, status) => (err) => err.code === c && err.statusCode === status;
const consultar = (uc, over = {}) => uc.consultarConversacion({ user: admin, solicitudId: SOLICITUD, correlationId: 'corr-1', body: { motivo: 'Queja por retraso del servicio' }, ...over });

test('C1: el administrador consulta con motivo y referencia; el contexto sale de la sesión, no del cuerpo', async () => {
  const { uc, llamadas } = crear();
  await consultar(uc, { body: { motivo: '  Queja por retraso  ', quejaRef: 'Q-2026.15', tenantId: 'otro', actorId: 'otro' } });

  assert.deepEqual(llamadas.consultar[0].ctx, admin);
  assert.deepEqual(llamadas.consultar[0].datos, {
    solicitudId: SOLICITUD, motivo: 'Queja por retraso', quejaRef: 'Q-2026.15', limite: 50, despuesDe: null, correlationId: 'corr-1',
  });
});

test('ADMIN_TENANT se normaliza a ADMIN y quejaRef es opcional', async () => {
  const { uc, llamadas } = crear();
  await consultar(uc, { user: { ...admin, role: 'ADMIN_TENANT' } });
  assert.equal(llamadas.consultar[0].ctx.role, 'ADMIN');
  assert.equal(llamadas.consultar[0].datos.quejaRef, null);
});

test('C3: el cliente, el aliado, la plataforma o un rol ausente no consultan ni listan', async () => {
  const { uc, llamadas } = crear();
  for (const role of ['CLIENT', 'ALLY', 'PLATFORM_ADMIN', undefined]) {
    await assert.rejects(() => consultar(uc, { user: { ...admin, role } }), codigo('MANI-MSG-403', 403));
    await assert.rejects(() => uc.listarConsultas({ user: { ...admin, role } }), codigo('MANI-MSG-403', 403));
  }
  assert.equal(llamadas.consultar.length + llamadas.listar.length, 0);
});

test('sin sesión o con usuario inválido responde 401', async () => {
  const { uc } = crear();
  await assert.rejects(() => consultar(uc, { user: null }), codigo('MANI-MSG-401', 401));
  await assert.rejects(() => consultar(uc, { user: { ...admin, userId: 'no-uuid' } }), codigo('MANI-MSG-401', 401));
  await assert.rejects(() => uc.listarConsultas({ user: null }), codigo('MANI-MSG-401', 401));
});

for (const [nombre, body] of [
  ['sin motivo', {}],
  ['motivo que no es texto', { motivo: 7 }],
  ['motivo de menos de 5 caracteres', { motivo: 'queja' .slice(0, 4) }],
  ['motivo de solo espacios', { motivo: '        ' }],
  ['motivo de más de 500 caracteres', { motivo: 'a'.repeat(501) }],
  ['motivo con carácter NUL', { motivo: 'queja\u0000 grave' }],
  ['quejaRef con espacios', { motivo: 'Queja por retraso', quejaRef: 'Q 1' }],
  ['quejaRef que no es texto', { motivo: 'Queja por retraso', quejaRef: 12 }],
  ['quejaRef de más de 100 caracteres', { motivo: 'Queja por retraso', quejaRef: 'q'.repeat(101) }],
  ['límite fuera de rango', { motivo: 'Queja por retraso', limite: 101 }],
  ['cursor que no es UUID', { motivo: 'Queja por retraso', despuesDe: 'x' }],
]) {
  test(`consultarConversacion: rechaza ${nombre} con 400 sin tocar el repositorio`, async () => {
    const { uc, llamadas } = crear();
    await assert.rejects(() => consultar(uc, { body }), codigo('MANI-MSG-400', 400));
    assert.equal(llamadas.consultar.length, 0);
  });
}

test('consultarConversacion: acepta exactamente 5 y 500 caracteres de motivo', async () => {
  const { uc, llamadas } = crear();
  await consultar(uc, { body: { motivo: 'abcde' } });
  await consultar(uc, { body: { motivo: 'a'.repeat(500) } });
  assert.deepEqual(llamadas.consultar.map((l) => l.datos.motivo.length), [5, 500]);
});

test('consultarConversacion: un id de solicitud inválido responde 400', async () => {
  const { uc } = crear();
  await assert.rejects(() => consultar(uc, { solicitudId: 'no-uuid' }), codigo('MANI-MSG-400', 400));
});

test('listarConsultas: límite por omisión de 50 y filtros opcionales', async () => {
  const { uc, llamadas } = crear();
  await uc.listarConsultas({ user: admin });
  await uc.listarConsultas({ user: admin, query: { limite: '10', despuesDe: CURSOR, solicitudId: SOLICITUD } });

  assert.deepEqual(llamadas.listar[0].datos, { limite: 50, despuesDe: null, solicitudId: null });
  assert.deepEqual(llamadas.listar[1].datos, { limite: 10, despuesDe: CURSOR, solicitudId: SOLICITUD });
  await assert.rejects(() => uc.listarConsultas({ user: admin, query: { limite: '0' } }), codigo('MANI-MSG-400', 400));
  await assert.rejects(() => uc.listarConsultas({ user: admin, query: { solicitudId: 'x' } }), codigo('MANI-MSG-400', 400));
});

test('el puerto no se usa sin implementar: cada método abstracto lo dice', async () => {
  const puerto = new IMessageRepository();
  for (const metodo of ['enviar', 'listar', 'consultarConversacion', 'listarConsultas']) {
    await assert.rejects(() => puerto[metodo]({}, {}), new RegExp(metodo));
  }
});
