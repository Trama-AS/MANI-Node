// SCRUM-1662 (T-25, QAS-02): proveedor push con falla inyectable.
const test = require('node:test');
const assert = require('node:assert/strict');
const FalibleMockPushProvider = require('../../../src/infrastructure/push/FalibleMockPushProvider');
const { createPushProvider, PushProviderConfigurationError } = require('../../../src/infrastructure/push/createPushProvider');
const PushProviderError = require('../../../src/domain/errors/PushProviderError');
const NotificarEventoServicioUseCase = require('../../../src/application/useCases/notifications/NotificarEventoServicioUseCase');

const mensaje = (id = 'n-1') => ({ notificacionId: id, tenantId: 't', usuarioId: 'u', tipo: 'X', payload: {}, idempotencyKey: id });

test('por omisión falla siempre con una falla pasajera (UNAVAILABLE) y no entrega nada', async () => {
  const push = new FalibleMockPushProvider();
  assert.equal(push.name, 'mock_falla');
  for (let i = 0; i < 3; i += 1) {
    await assert.rejects(push.send(mensaje()), (e) => e instanceof PushProviderError && e.kind === 'UNAVAILABLE' && e.transient === true);
  }
  assert.equal(push.sent.length, 0);
});

test('con fallas = N fallan los N primeros intentos de cada notificación y el siguiente entrega', async () => {
  const push = new FalibleMockPushProvider({ fallas: 1 });
  await assert.rejects(push.send(mensaje('a')), PushProviderError);
  const entrega = await push.send(mensaje('a'));
  assert.equal(entrega.estado, 'SIMULADA');
  // Otra notificación empieza su cuenta desde cero.
  await assert.rejects(push.send(mensaje('b')), PushProviderError);
  assert.equal(push.sent.length, 1);
});

test('createPushProvider elige mock_falla, pasa las fallas y lo prohíbe en producción', () => {
  const push = createPushProvider('mock_falla', { environment: 'qa', fallas: 2 });
  assert.equal(push.fallas, 2);
  assert.throws(() => createPushProvider('mock_falla', { environment: 'production' }), PushProviderConfigurationError);
  assert.equal(createPushProvider('mock', { environment: 'production' }).name, 'mock', 'el mock normal sigue permitido');
});

// ---- La falla no revierte la operación y el reintento la recupera ----

const TENANT = '11111111-1111-4111-8111-111111111111';
const CLIENTE = '22222222-2222-4222-8222-222222222222';
const ALIADO = '33333333-3333-4333-8333-333333333333';

function notificador(push, politica) {
  const creadas = [];
  const repo = {
    participantesDeSolicitud: async () => ({ clienteUsuarioId: CLIENTE, aliadoUsuarioId: ALIADO, categoria: 'Plomería' }),
    crearParaUsuario: async (ctx, n) => {
      const fila = { id: `n-${creadas.length + 1}`, ...n };
      creadas.push(fila);
      return { id: fila.id, usuarioId: n.usuarioId, nueva: true };
    },
  };
  return { creadas, uc: new NotificarEventoServicioUseCase({ notificacionRepository: repo, pushProvider: push, politica, logger: () => {} }) };
}

const evento = { solicitudId: 's-1', destino: 'CONTRARIO', tipo: 'MENSAJE_NUEVO', claveEvento: 'm-1', correlationId: 'c' };
const sesion = { tenantId: TENANT, userId: CLIENTE, role: 'CLIENT' };

test('C2: con el push caído siempre, la notificación queda en la bandeja y la operación no se revierte (FALLIDA, sin excepción)', async () => {
  const { uc, creadas } = notificador(new FalibleMockPushProvider(), { timeoutMs: 200, retries: 1, baseDelayMs: 1 });
  const r = await uc.execute(sesion, evento);
  assert.equal(r.estado, 'FALLIDA');
  assert.equal(creadas.length, 1, 'la notificación ya estaba en la bandeja');
});

test('C2: con una falla pasajera el reintento entrega y no duplica el aviso', async () => {
  const push = new FalibleMockPushProvider({ fallas: 1 });
  const { uc, creadas } = notificador(push, { timeoutMs: 200, retries: 1, baseDelayMs: 1 });
  const r = await uc.execute(sesion, evento);
  assert.equal(r.estado, 'SIMULADA');
  assert.equal(creadas.length, 1);
  assert.equal(push.sent.length, 1, 'se entregó una sola vez');
});

test('C2: sin reintentos, una falla pasajera queda FALLIDA (retries = 0 los desactiva)', async () => {
  const { uc } = notificador(new FalibleMockPushProvider({ fallas: 1 }), { timeoutMs: 200, retries: 0 });
  assert.equal((await uc.execute(sesion, evento)).estado, 'FALLIDA');
});

test('la política de eventos reparte el techo de 2 s entre los intentos: reintentar no alarga la espera (SCRUM-1662)', () => {
  const politica = NotificarEventoServicioUseCase.politicaDe;
  assert.deepEqual(politica({ timeoutMs: 5000, retries: 0 }), { timeoutMs: 2000, retries: 0, baseDelayMs: 50 });
  assert.deepEqual(politica({ timeoutMs: 5000, retries: 1 }), { timeoutMs: 1000, retries: 1, baseDelayMs: 50 });
  assert.deepEqual(politica({ timeoutMs: 5000, retries: 3 }), { timeoutMs: 500, retries: 3, baseDelayMs: 50 });
  // Un timeout configurado menor que el techo manda; y nunca baja de 250 ms por intento.
  assert.equal(politica({ timeoutMs: 600, retries: 1 }).timeoutMs, 300);
  assert.equal(politica({ timeoutMs: 5000, retries: 20 }).timeoutMs, 250);
  // Valores inválidos de reintentos se tratan como 0.
  assert.equal(politica({ timeoutMs: 5000, retries: -1 }).retries, 0);
});
