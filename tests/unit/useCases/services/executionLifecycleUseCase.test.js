const test = require('node:test');
const assert = require('node:assert/strict');
const ExecutionLifecycleUseCase = require('../../../../src/application/useCases/services/ExecutionLifecycleUseCase');
const InMemorySolicitudRepository = require('../../../../src/infrastructure/repositories/InMemorySolicitudRepository');
const InMemoryEventoServicioRepository = require('../../../../src/infrastructure/repositories/InMemoryEventoServicioRepository');

const TENANT = 'tenant-a';
const ally = { userId: 'usuario-aliado-1', tenantId: TENANT, role: 'ALLY' };

function setup({ aliado = { id: 'aliado-1', usuarioId: 'usuario-aliado-1', tenantId: TENANT }, solicitud = {} } = {}) {
  const solicitudRepository = new InMemorySolicitudRepository();
  const eventoServicioRepository = new InMemoryEventoServicioRepository();
  solicitudRepository.seed({ id: 'sol-1', tenantId: TENANT, clienteId: 'cliente-1', categoriaId: 'c', zonaId: 'z', aliadoId: 'aliado-1', estado: 'ACEPTADA', ...solicitud });
  const aliadoRepository = {
    findByUsuarioId: async (tenantId, usuarioId) => (aliado && aliado.tenantId === tenantId && aliado.usuarioId === usuarioId ? aliado : null),
  };
  return { useCase: new ExecutionLifecycleUseCase({ solicitudRepository, eventoServicioRepository, aliadoRepository }), solicitudRepository, eventoServicioRepository };
}

test('flujo inicio → fin: cambia el estado y deja INICIO_EJECUCION y FIN_EJECUCION con su hora en evento_servicio', async () => {
  const { useCase, eventoServicioRepository } = setup();

  const inicio = await useCase.startExecution({ user: ally, solicitudId: 'sol-1', observacion: ' Llegada al sitio ' });
  const fin = await useCase.finishExecution({ user: ally, solicitudId: 'sol-1' });

  assert.equal(inicio.solicitud.estado, 'EN_EJECUCION');
  assert.equal(inicio.evento.descripcion, 'Llegada al sitio');
  assert.equal(fin.solicitud.estado, 'FINALIZADA');
  const eventos = await eventoServicioRepository.findBySolicitudId({ tenantId: TENANT }, 'sol-1');
  assert.deepEqual(eventos.map((e) => e.tipoEvento), ['INICIO_EJECUCION', 'FIN_EJECUCION']);
  assert.ok(eventos.every((e) => e.fecha && e.actorId === 'usuario-aliado-1'));
});

for (const estado of ['ASIGNADA', 'COTIZANDO', 'ACEPTADA']) {
  test(`se puede iniciar desde ${estado}`, async () => {
    const { useCase } = setup({ solicitud: { estado } });

    assert.equal((await useCase.startExecution({ user: ally, solicitudId: 'sol-1' })).solicitud.estado, 'EN_EJECUCION');
  });
}

for (const [estado, mensaje] of [['EN_EJECUCION', /ya fue iniciada/], ['FINALIZADA', /estado FINALIZADA/], ['CANCELADA', /estado CANCELADA/]]) {
  test(`iniciar desde ${estado} responde 409`, async () => {
    const { useCase } = setup({ solicitud: { estado } });

    await assert.rejects(() => useCase.startExecution({ user: ally, solicitudId: 'sol-1' }), (e) => e.statusCode === 409 && mensaje.test(e.message));
  });
}

test('finalizar sin haber iniciado responde 409 y un servicio ya finalizado también', async () => {
  const sinIniciar = setup({ solicitud: { estado: 'ACEPTADA' } });
  const yaFinal = setup({ solicitud: { estado: 'FINALIZADA' } });

  await assert.rejects(() => sinIniciar.useCase.finishExecution({ user: ally, solicitudId: 'sol-1' }), (e) => e.statusCode === 409 && /no ha sido iniciado/.test(e.message));
  await assert.rejects(() => yaFinal.useCase.finishExecution({ user: ally, solicitudId: 'sol-1' }), (e) => e.statusCode === 409 && /ya se encuentra finalizado/.test(e.message));
});

test('dos inicios simultáneos: solo uno cambia el estado, el otro recibe 409', async () => {
  const { useCase, eventoServicioRepository } = setup();

  const r = await Promise.allSettled([
    useCase.startExecution({ user: ally, solicitudId: 'sol-1' }),
    useCase.startExecution({ user: ally, solicitudId: 'sol-1' }),
  ]);

  assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(r.find((x) => x.status === 'rejected').reason.statusCode, 409);
  assert.equal((await eventoServicioRepository.findBySolicitudId({ tenantId: TENANT }, 'sol-1')).length, 1);
});

test('compara solicitud.aliado_id con aliado.id: otro aliado recibe 403', async () => {
  const { useCase } = setup({ solicitud: { aliadoId: 'aliado-2' } });

  await assert.rejects(() => useCase.startExecution({ user: ally, solicitudId: 'sol-1' }), (e) => e.statusCode === 403);
});

test('sin perfil de aliado responde 403; cross-tenant responde 404', async () => {
  await assert.rejects(() => setup({ aliado: null }).useCase.startExecution({ user: ally, solicitudId: 'sol-1' }), (e) => e.statusCode === 403);
  await assert.rejects(() => setup({ solicitud: { tenantId: 'tenant-b' } }).useCase.startExecution({ user: ally, solicitudId: 'sol-1' }), (e) => e.statusCode === 404);
});

test('un cliente, una sesión sin tenant o sin solicitud no pasan', async () => {
  const { useCase } = setup();

  await assert.rejects(() => useCase.startExecution({ user: { ...ally, role: 'CLIENT' }, solicitudId: 'sol-1' }), (e) => e.statusCode === 403);
  await assert.rejects(() => useCase.finishExecution({ user: { userId: 'x', role: 'ALLY' }, solicitudId: 'sol-1' }), (e) => e.statusCode === 403);
  await assert.rejects(() => useCase.startExecution({ user: ally, solicitudId: '' }), (e) => e.statusCode === 400);
});

test('exige sus dependencias', () => {
  assert.throws(() => new ExecutionLifecycleUseCase({}), /solicitudRepository/);
  assert.throws(() => new ExecutionLifecycleUseCase({ solicitudRepository: {} }), /eventoServicioRepository/);
  assert.throws(() => new ExecutionLifecycleUseCase({ solicitudRepository: {}, eventoServicioRepository: {} }), /aliadoRepository/);
});
