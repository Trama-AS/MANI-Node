const test = require('node:test');
const assert = require('node:assert/strict');
const { entregarAviso } = require('../../../../src/application/useCases/notifications/entregarAviso');
const CreateQuoteUseCase = require('../../../../src/application/useCases/quotes/CreateQuoteUseCase');
const RespondQuoteUseCase = require('../../../../src/application/useCases/quotes/RespondQuoteUseCase');
const ServiceExecutionUseCase = require('../../../../src/application/useCases/services/ServiceExecutionUseCase');
const CancelServiceRequestUseCase = require('../../../../src/application/useCases/requests/CancelServiceRequestUseCase');
const AssignServiceRequestUseCase = require('../../../../src/application/useCases/requests/AssignServiceRequestUseCase');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';
const AVISO = '44444444-4444-4444-8444-444444444444';
const sesion = (role) => ({ tenantId: TENANT, userId: USER, role });
const ctxDe = (role) => ({ tenantId: TENANT, userId: USER, role });

function notificadorFalso() {
  const entregas = [];
  return { entregas, entregar: async (ctx, datos) => (entregas.push({ ctx, datos }), { estado: 'SIMULADA' }) };
}

// Cada caso de uso del ciclo del servicio: cómo se construye, cómo se invoca y qué devuelve el repositorio.
const CASOS = [
  {
    nombre: 'emitir cotización (aviso al cliente)',
    role: 'ALLY',
    resultado: { id: 'cot-1', version: 1, total: 150 },
    crear: (repo, notificador) => new CreateQuoteUseCase({ quoteRepository: { emitir: repo }, notificador }),
    invocar: (uc, correlationId) => uc.execute({ user: sesion('ALLY'), solicitudId: ID, body: { valorManoObra: 100, valorMateriales: 50 }, correlationId }),
  },
  {
    nombre: 'responder cotización (aviso al aliado)',
    role: 'CLIENT',
    resultado: { cotizacion: { id: 'cot-1' }, solicitud: { id: ID, estado: 'ACEPTADA' } },
    crear: (repo, notificador) => new RespondQuoteUseCase({ quoteRepository: { responder: repo }, notificador }),
    invocar: (uc, correlationId) => uc.execute({ user: sesion('CLIENT'), cotizacionId: ID, accion: 'ACEPTAR', body: {}, correlationId }),
  },
  {
    nombre: 'iniciar ejecución (aviso al cliente)',
    role: 'ALLY',
    resultado: { solicitud: { id: ID, estado: 'EN_EJECUCION' }, evento: { tipo: 'INICIO_EJECUCION' } },
    crear: (repo, notificador) => new ServiceExecutionUseCase({ serviceExecutionRepository: { marcar: repo }, notificador }),
    invocar: (uc, correlationId) => uc.marcar({ user: sesion('ALLY'), solicitudId: ID, hito: 'INICIO', body: {}, correlationId }),
  },
  {
    nombre: 'cancelar solicitud (aviso al aliado)',
    role: 'CLIENT',
    resultado: { solicitud: { id: ID, estado: 'CANCELADA' }, cancelada: true },
    crear: (repo, notificador) => new CancelServiceRequestUseCase({ serviceRequestRepository: { cancelar: repo }, notificador }),
    invocar: (uc, correlationId) => uc.execute({ user: sesion('CLIENT'), solicitudId: ID, body: {}, correlationId }),
  },
  {
    nombre: 'asignar solicitud (aviso al cliente)',
    role: 'ALLY',
    resultado: { solicitud: { id: ID, estado: 'ASIGNADA' }, asignada: true },
    crear: (repo, notificador) => new AssignServiceRequestUseCase({ solicitudAsignacionRepository: { asignar: repo }, notificador, auditLogger: () => {} }),
    invocar: (uc, correlationId) => uc.execute({ user: sesion('ALLY'), solicitudId: ID, correlationId }),
  },
];

for (const caso of CASOS) {
  test(`C1 ${caso.nombre}: tras la operación se entrega el aviso, con el correlationId, y el id no sale en la respuesta`, async () => {
    const notificador = notificadorFalso();
    const uc = caso.crear(async () => ({ ...caso.resultado, notificacionId: AVISO }), notificador);

    const respuesta = await caso.invocar(uc, 'corr-884');

    assert.deepEqual(respuesta, caso.resultado, 'la respuesta pública no cambia ni filtra el id interno del aviso');
    assert.deepEqual(notificador.entregas, [{ ctx: ctxDe(caso.role), datos: { notificacionId: AVISO, correlationId: 'corr-884' } }]);
  });

  test(`C2 ${caso.nombre}: si la operación falla no se entrega ningún aviso`, async () => {
    const notificador = notificadorFalso();
    const uc = caso.crear(async () => { throw new Error('operación rechazada'); }, notificador);

    await assert.rejects(() => caso.invocar(uc), /operación rechazada/);

    assert.equal(notificador.entregas.length, 0);
  });

  test(`C2 ${caso.nombre}: sin aviso nuevo (reintento) no se entrega nada`, async () => {
    const notificador = notificadorFalso();
    const uc = caso.crear(async () => ({ ...caso.resultado }), notificador);

    assert.deepEqual(await caso.invocar(uc), caso.resultado);

    assert.equal(notificador.entregas.length, 0);
  });

  test(`${caso.nombre}: sin notificador la operación funciona igual`, async () => {
    const uc = caso.crear(async () => ({ ...caso.resultado, notificacionId: AVISO }), null);
    assert.deepEqual(await caso.invocar(uc), caso.resultado);
  });
}

test('entregarAviso: sin notificador o sin id no hace nada y con ambos entrega una vez', async () => {
  const notificador = notificadorFalso();
  await entregarAviso(null, ctxDe('CLIENT'), AVISO);
  await entregarAviso(notificador, ctxDe('CLIENT'), undefined);
  assert.equal(notificador.entregas.length, 0);
  await entregarAviso(notificador, ctxDe('CLIENT'), AVISO, 'c');
  assert.equal(notificador.entregas.length, 1);
});
