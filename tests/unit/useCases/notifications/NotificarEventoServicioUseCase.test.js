const test = require('node:test');
const assert = require('node:assert/strict');
const NotificarEventoServicioUseCase = require('../../../../src/application/useCases/notifications/NotificarEventoServicioUseCase');
const MockPushProvider = require('../../../../src/infrastructure/push/MockPushProvider');
const PushProviderError = require('../../../../src/domain/errors/PushProviderError');

const TENANT = '11111111-1111-4111-8111-111111111111';
const CLIENTE = '22222222-2222-4222-8222-222222222222';
const ALIADO = '33333333-3333-4333-8333-333333333333';
const TERCERO = '44444444-4444-4444-8444-444444444444';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';
const participantes = { clienteUsuarioId: CLIENTE, aliadoUsuarioId: ALIADO, categoria: 'Plomería', estado: 'ACEPTADA' };

/** Repositorio en memoria con la misma regla de unicidad por (usuario, tipo, claveEvento). */
function crearRepo({ datos = participantes, falloCrear = null } = {}) {
  const creadas = [];
  return {
    creadas,
    participantesDeSolicitud: async () => datos,
    crearParaUsuario: async (ctx, n) => {
      if (falloCrear) throw falloCrear;
      const previa = creadas.find((c) => c.usuarioId === n.usuarioId && c.tipo === n.tipo && c.claveEvento === n.claveEvento);
      if (previa) return { id: previa.id, usuarioId: n.usuarioId, nueva: false };
      const fila = { id: `n-${creadas.length + 1}`, ...n };
      creadas.push(fila);
      return { id: fila.id, usuarioId: n.usuarioId, nueva: true };
    },
  };
}

function crear({ repo = crearRepo(), push = new MockPushProvider(), politica } = {}) {
  const registros = [];
  const uc = new NotificarEventoServicioUseCase({ notificacionRepository: repo, pushProvider: push, politica, logger: (e) => registros.push(e) });
  return { uc, repo, push, registros };
}

const evento = (over = {}) => ({ solicitudId: SOLICITUD, destino: 'CONTRARIO', tipo: 'MENSAJE_NUEVO', claveEvento: 'm-1', payload: { mensajeId: 'm-1', remitenteRol: 'CLIENT' }, correlationId: 'corr-1', ...over });
const sesion = (userId) => ({ tenantId: TENANT, userId, role: 'CLIENT' });

test('C1: el cliente escribe y la notificación llega al aliado, con remitente y servicio, por la frontera push', async () => {
  const { uc, repo, push } = crear();

  const r = await uc.execute(sesion(CLIENTE), evento());

  assert.equal(r.estado, 'SIMULADA');
  assert.equal(repo.creadas[0].usuarioId, ALIADO);
  assert.deepEqual(repo.creadas[0].payload, { mensajeId: 'm-1', remitenteRol: 'CLIENT', requestId: SOLICITUD, categoria: 'Plomería' });
  assert.equal(repo.creadas[0].canal, 'PUSH');
  const enviado = push.sentTo(TENANT, ALIADO);
  assert.equal(enviado.length, 1);
  assert.equal(enviado[0].idempotencyKey, r.notificacionId);
  assert.equal(enviado[0].correlationId, 'corr-1');
});

test('C1: el aliado escribe y la notificación llega al cliente', async () => {
  const { uc, repo, push } = crear();
  await uc.execute({ ...sesion(ALIADO), role: 'ALLY' }, evento({ payload: { mensajeId: 'm-2', remitenteRol: 'ALLY' }, claveEvento: 'm-2' }));
  assert.equal(repo.creadas[0].usuarioId, CLIENTE);
  assert.equal(push.sentTo(TENANT, CLIENTE).length, 1);
});

test('el destino explícito CLIENTE o ALIADO ignora quién origina el evento', async () => {
  const { uc, repo } = crear();
  await uc.execute(sesion(ALIADO), evento({ destino: 'CLIENTE', claveEvento: 'a' }));
  await uc.execute(sesion(CLIENTE), evento({ destino: 'ALIADO', claveEvento: 'b' }));
  assert.deepEqual(repo.creadas.map((c) => c.usuarioId), [CLIENTE, ALIADO]);
});

test('C2: repetir el mismo evento no crea otra notificación ni otro push', async () => {
  const { uc, repo, push } = crear();
  const primera = await uc.execute(sesion(CLIENTE), evento());
  const repetida = await uc.execute(sesion(CLIENTE), evento());

  assert.equal(primera.estado, 'SIMULADA');
  assert.equal(repetida.estado, 'DUPLICADA');
  assert.equal(repetida.notificacionId, primera.notificacionId);
  assert.equal(repo.creadas.length, 1);
  assert.equal(push.sent.length, 1);
});

test('C2: un evento distinto del mismo servicio sí notifica', async () => {
  const { uc, push } = crear();
  await uc.execute(sesion(CLIENTE), evento({ claveEvento: 'm-1' }));
  await uc.execute(sesion(CLIENTE), evento({ claveEvento: 'm-2' }));
  assert.equal(push.sent.length, 2);
});

test('C2: si el push falla la notificación queda en la bandeja, se informa FALLIDA y no lanza', async () => {
  const push = { name: 'caido', simulated: false, send: async () => { throw new PushProviderError('UNAVAILABLE', 'caído'); } };
  const { uc, repo } = crear({ push });

  const r = await uc.execute(sesion(CLIENTE), evento());

  assert.equal(r.estado, 'FALLIDA');
  assert.equal(repo.creadas.length, 1, 'ya estaba persistida');
});

test('C2: un push que no responde se corta por timeout y se informa FALLIDA', async () => {
  const push = { name: 'lento', simulated: false, send: ({ signal }) => new Promise((_, rechazar) => signal.addEventListener('abort', () => rechazar(new Error('abortado')))) };
  const { uc } = crear({ push, politica: { timeoutMs: 20, retries: 0 } });
  assert.equal((await uc.execute(sesion(CLIENTE), evento())).estado, 'FALLIDA');
});

test('C2: si falla la base al crear la notificación no lanza y deja registro sin datos personales', async () => {
  const { uc, registros } = crear({ repo: crearRepo({ falloCrear: new Error('conexión rota con usuario@correo.test') }) });

  const r = await uc.execute(sesion(CLIENTE), evento());

  assert.equal(r.estado, 'ERROR');
  assert.equal(registros.length, 1);
  assert.equal(registros[0].tipo, 'MENSAJE_NUEVO');
  assert.equal(JSON.stringify(registros[0]).includes('correo.test'), false, 'solo el nombre del error, nunca su mensaje');
});

test('C3: un tercero que origina el evento no genera notificación a nadie', async () => {
  const { uc, repo, push } = crear();
  const r = await uc.execute(sesion(TERCERO), evento());
  assert.equal(r.estado, 'SIN_DESTINATARIO');
  assert.equal(repo.creadas.length + push.sent.length, 0);
});

test('C3: solicitud inexistente o de otro tenant, aliado sin asignar o autor igual al destinatario: sin destinatario', async () => {
  assert.equal((await crear({ repo: crearRepo({ datos: null }) }).uc.execute(sesion(CLIENTE), evento())).estado, 'SIN_DESTINATARIO');
  const sinAliado = crearRepo({ datos: { ...participantes, aliadoUsuarioId: null } });
  assert.equal((await crear({ repo: sinAliado }).uc.execute(sesion(CLIENTE), evento())).estado, 'SIN_DESTINATARIO');
  assert.equal((await crear().uc.execute(sesion(CLIENTE), evento({ destino: 'CLIENTE' }))).estado, 'SIN_DESTINATARIO', 'no se notifica al propio autor');
});

test('C3: el usuario destino no existe en el tenant: sin destinatario', async () => {
  const repo = { participantesDeSolicitud: async () => participantes, crearParaUsuario: async () => null };
  assert.equal((await crear({ repo }).uc.execute(sesion(CLIENTE), evento())).estado, 'SIN_DESTINATARIO');
});

test('un destino inválido es un error de programación y se informa ERROR sin lanzar', async () => {
  const { uc, registros } = crear();
  assert.equal((await uc.execute(sesion(CLIENTE), evento({ destino: 'TODOS' }))).estado, 'ERROR');
  assert.equal(registros.length, 1);
});

test('el constructor exige el repositorio y el proveedor', () => {
  assert.throws(() => new NotificarEventoServicioUseCase({ pushProvider: new MockPushProvider() }), /notificacionRepository/);
  assert.throws(() => new NotificarEventoServicioUseCase({ notificacionRepository: crearRepo() }), /pushProvider/);
});
