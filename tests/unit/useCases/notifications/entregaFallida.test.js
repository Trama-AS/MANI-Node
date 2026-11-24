const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const NotificarEventoServicioUseCase = require('../../../../src/application/useCases/notifications/NotificarEventoServicioUseCase');
const PublishNotificationUseCase = require('../../../../src/application/useCases/dispatch/PublishNotificationUseCase');
const { politicaPushConTecho, esperaMaximaMs } = require('../../../../src/application/providers/politicaPushConTecho');
const IPushProvider = require('../../../../src/domain/ports/IPushProvider');
const PushProviderError = require('../../../../src/domain/errors/PushProviderError');

// SCRUM-1662 (QAS-02, remedición en QA del 24-nov): dos faltas. (1) Core no registraba la falla de entrega del push: los
// `catch` devolvían FALLIDA sin dejar rastro. (2) La oferta de despacho esperaba hasta 3 intentos de 5 s (15 s) y
// Dispatch corta cada llamada a Core a los 10 s, así que la orquestación respondía 503 y dejaba 1 de 2 ofertas.

const TENANT = '11111111-1111-4111-8111-111111111111';
const CLIENTE = '22222222-2222-4222-8222-222222222222';
const ALIADO = '33333333-3333-4333-8333-333333333333';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';
const ALLY_ID = '66666666-6666-4666-8666-666666666666';

/** Push que nunca responde: solo termina cuando Core aborta la señal por timeout. */
class PushSinRespuesta extends IPushProvider {
  constructor() {
    super();
    this.intentos = 0;
  }
  get name() {
    return 'sin_respuesta';
  }
  get simulated() {
    return true;
  }
  send({ signal }) {
    this.intentos += 1;
    return new Promise((_, rechazar) => signal.addEventListener('abort', () => rechazar(new Error('abortado'))));
  }
}

/** Push que falla siempre con el tipo de error indicado. */
class PushQueFalla extends IPushProvider {
  constructor(kind) {
    super();
    this.kind = kind;
  }
  get name() {
    return 'que_falla';
  }
  get simulated() {
    return true;
  }
  async send() {
    throw new PushProviderError(this.kind, 'detalle interno del proveedor 10.0.0.5 token=abc');
  }
}

function repoEventos() {
  return {
    participantesDeSolicitud: async () => ({ clienteUsuarioId: CLIENTE, aliadoUsuarioId: ALIADO, categoria: 'Plomería', estado: 'ACEPTADA' }),
    crearParaUsuario: async () => ({ id: 'n-1', usuarioId: ALIADO, nueva: true }),
  };
}
const sesionCliente = { tenantId: TENANT, userId: CLIENTE, role: 'CLIENT' };
const evento = { solicitudId: SOLICITUD, destino: 'CONTRARIO', tipo: 'MENSAJE_NUEVO', claveEvento: 'm-1', payload: { mensajeId: 'm-1', texto: 'dato sensible' }, correlationId: 'corr-evento-7' };

function publicar({ push, politica }) {
  const registros = [];
  const useCase = new PublishNotificationUseCase({
    notificacionRepository: { createForAlly: async () => ({ id: 'n-9', usuarioId: ALIADO, nueva: true }) },
    pushProvider: push,
    politica,
    logger: (e) => registros.push(e),
  });
  const ejecutar = () =>
    useCase.execute({
      session: { userId: 'u-admin', tenantId: TENANT, role: 'ADMIN' },
      body: { allyId: ALLY_ID, tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload: { requestId: SOLICITUD } },
      correlationId: 'corr-oferta-3',
    });
  return { ejecutar, registros };
}

// ---- 1. La falla de entrega queda registrada con la correlación ----

test('evento del servicio: un push caído se informa FALLIDA y queda un log con la correlación y la causa', async () => {
  const registros = [];
  const uc = new NotificarEventoServicioUseCase({
    notificacionRepository: repoEventos(),
    pushProvider: new PushQueFalla('UNAVAILABLE'),
    politica: { timeoutMs: 100, retries: 0 },
    logger: (e) => registros.push(e),
  });

  const r = await uc.execute(sesionCliente, evento);

  assert.equal(r.estado, 'FALLIDA');
  assert.equal(registros.length, 1);
  assert.deepEqual(registros[0], {
    event: 'notificacion.entrega_fallida',
    tenant_id: TENANT,
    notificacion_id: 'n-1',
    canal: 'PUSH',
    proveedor: 'que_falla',
    causa: 'UNAVAILABLE',
    correlation_id: 'corr-evento-7',
  });
});

test('oferta de despacho: un push caído se informa FALLIDA y queda un log con la correlación y la causa', async () => {
  const { ejecutar, registros } = publicar({ push: new PushQueFalla('TIMEOUT'), politica: { timeoutMs: 100, retries: 0 } });

  const r = await ejecutar();

  assert.equal(r.entrega.estado, 'FALLIDA');
  assert.equal(r.nueva, true, 'la oferta queda creada aunque el push falle');
  assert.equal(registros.length, 1);
  assert.equal(registros[0].event, 'notificacion.entrega_fallida');
  assert.equal(registros[0].correlation_id, 'corr-oferta-3');
  assert.equal(registros[0].notificacion_id, 'n-9');
  assert.equal(registros[0].causa, 'TIMEOUT');
  assert.equal(registros[0].tenant_id, TENANT);
});

test('el log de la falla no lleva el detalle del proveedor, el payload ni datos personales', async () => {
  const registros = [];
  const uc = new NotificarEventoServicioUseCase({
    notificacionRepository: repoEventos(),
    pushProvider: new PushQueFalla('UNAVAILABLE'),
    politica: { timeoutMs: 100, retries: 0 },
    logger: (e) => registros.push(e),
  });
  await uc.execute(sesionCliente, evento);
  const { ejecutar, registros: deLaOferta } = publicar({ push: new PushQueFalla('UNAVAILABLE'), politica: { timeoutMs: 100, retries: 0 } });
  await ejecutar();

  for (const linea of [...registros, ...deLaOferta].map((e) => JSON.stringify(e))) {
    assert.doesNotMatch(linea, /10\.0\.0\.5|token=abc|dato sensible|mensajeId|requestId/);
  }
});

test('una entrega que sale bien no deja log de falla', async () => {
  const { ejecutar, registros } = publicar({ push: new (require('../../../../src/infrastructure/push/MockPushProvider'))(), politica: { timeoutMs: 100, retries: 0 } });
  const r = await ejecutar();
  assert.notEqual(r.entrega.estado, 'FALLIDA');
  assert.equal(registros.length, 0);
});

// ---- 2. La oferta no espera más que el techo ----

test('política con techo: reparte el techo entre los intentos y nunca baja de 250 ms por intento', () => {
  assert.deepEqual(politicaPushConTecho({ timeoutMs: 5000, retries: 2, techoMs: 3000 }), { timeoutMs: 1000, retries: 2, baseDelayMs: 50 });
  assert.equal(politicaPushConTecho({ timeoutMs: 5000, retries: 2, techoMs: 300 }).timeoutMs, 250);
  assert.equal(politicaPushConTecho({ timeoutMs: 400, retries: 0, techoMs: 3000 }).timeoutMs, 400, 'el techo no alarga un plazo que ya era menor');
  for (const retries of [-1, 1.5, NaN, undefined, null]) {
    assert.equal(politicaPushConTecho({ timeoutMs: 1000, retries, techoMs: 3000 }).retries, 0, `retries=${retries}`);
  }
});

test('la espera máxima de la política por omisión de la oferta cabe en los 10 s con que Dispatch corta a Core', () => {
  const politica = politicaPushConTecho({ timeoutMs: 5000, retries: PublishNotificationUseCase.POLITICA_PUSH.retries, techoMs: 3000 });
  const espera = esperaMaximaMs(politica);
  assert.ok(espera <= 3500, `espera máxima ${espera} ms`);
  assert.ok(espera < 10_000 / 2, 'debe sobrar margen: Dispatch orquesta varias ofertas seguidas');
  // El valor que había antes: 3 intentos de 5 s más las pausas.
  assert.ok(esperaMaximaMs(PublishNotificationUseCase.POLITICA_PUSH) > 10_000, 'la política vieja no cabía');
});

test('con un push que no responde, la oferta termina dentro del techo y registra TIMEOUT', async () => {
  const push = new PushSinRespuesta();
  const politica = politicaPushConTecho({ timeoutMs: 5000, retries: 2, techoMs: 600 });
  const { ejecutar, registros } = publicar({ push, politica });

  const inicio = Date.now();
  const r = await ejecutar();
  const duracion = Date.now() - inicio;

  assert.equal(r.entrega.estado, 'FALLIDA');
  assert.equal(push.intentos, 3, 'sigue reintentando, pero dentro del techo');
  assert.ok(duracion < 1200, `tardó ${duracion} ms con un techo de 600 ms`);
  assert.equal(registros[0].causa, 'TIMEOUT');
});

test('el Composition Root arma la oferta con el techo configurable (PUSH_OFERTA_TECHO_MS)', () => {
  const raiz = path.join(__dirname, '../../../../src');
  const container = fs.readFileSync(path.join(raiz, 'container.js'), 'utf8');
  const config = fs.readFileSync(path.join(raiz, 'config/index.js'), 'utf8');
  assert.match(container, /politicaPushConTecho\(\{[\s\S]*techoMs: config\.pushOfertaTechoMs/);
  assert.match(config, /pushOfertaTechoMs: positiveIntFromEnv\('PUSH_OFERTA_TECHO_MS', 3000\)/);
});
