const test = require('node:test');
const assert = require('node:assert/strict');
const RespondQuoteUseCase = require('../../../../src/application/useCases/quotes/RespondQuoteUseCase');
const InMemoryCotizacionRepository = require('../../../../src/infrastructure/repositories/InMemoryCotizacionRepository');
const InMemorySolicitudRepository = require('../../../../src/infrastructure/repositories/InMemorySolicitudRepository');
const InMemoryEventoServicioRepository = require('../../../../src/infrastructure/repositories/InMemoryEventoServicioRepository');

const TENANT = 'tenant-a';
const clienteUser = { userId: 'usuario-cliente-1', tenantId: TENANT, role: 'CLIENT' };

async function setup({ cliente = { id: 'cliente-1', usuarioId: 'usuario-cliente-1', tenantId: TENANT }, solicitud = {}, cotizacion = {} } = {}) {
  const cotizacionRepository = new InMemoryCotizacionRepository();
  const solicitudRepository = new InMemorySolicitudRepository();
  const eventoServicioRepository = new InMemoryEventoServicioRepository();
  solicitudRepository.seed({ id: 'sol-1', tenantId: TENANT, clienteId: 'cliente-1', categoriaId: 'c', zonaId: 'z', aliadoId: 'aliado-1', estado: 'COTIZANDO', ...solicitud });
  const cot = await cotizacionRepository.create(
    { tenantId: cotizacion.tenantId || TENANT },
    { id: 'cot-1', solicitudId: 'sol-1', aliadoId: 'aliado-1', valorManoObra: 100, valorMateriales: 20, estado: 'PENDIENTE', version: 1, ...cotizacion }
  );
  const clienteRepository = {
    findByUsuarioId: async (tenantId, usuarioId) =>
      cliente && cliente.tenantId === tenantId && cliente.usuarioId === usuarioId ? cliente : null,
  };
  const useCase = new RespondQuoteUseCase({ cotizacionRepository, solicitudRepository, eventoServicioRepository, clienteRepository });
  return { useCase, cot, cotizacionRepository, solicitudRepository, eventoServicioRepository };
}

for (const [accion, extra, estadoCot, estadoSol, evento] of [
  ['ACEPTAR', {}, 'ACEPTADA', 'ACEPTADA', 'COTIZACION_ACEPTADA'],
  ['RECHAZAR', { motivo: 'Muy costosa' }, 'RECHAZADA', 'RECHAZADA', 'COTIZACION_RECHAZADA'],
  ['AJUSTAR', { comentario: 'Bajar materiales' }, 'AJUSTE_SOLICITADO', 'COTIZANDO', 'AJUSTE_SOLICITADO'],
]) {
  test(`${accion}: el cliente dueño (cliente.id) cambia la cotización y la solicitud y registra ${evento}`, async () => {
    const { useCase, eventoServicioRepository } = await setup();

    const result = await useCase.execute({ user: clienteUser, cotizacionId: 'cot-1', accion, ...extra });

    assert.equal(result.cotizacion.estado, estadoCot);
    assert.equal(result.solicitud.estado, estadoSol);
    const eventos = await eventoServicioRepository.findBySolicitudId({ tenantId: TENANT }, 'sol-1');
    assert.equal(eventos.at(-1).tipoEvento, evento);
    assert.equal(eventos.at(-1).actorId, 'usuario-cliente-1');
  });
}

test('responder dos veces la misma cotización responde 409 (transición solo desde PENDIENTE)', async () => {
  const { useCase } = await setup();
  await useCase.execute({ user: clienteUser, cotizacionId: 'cot-1', accion: 'ACEPTAR' });

  await assert.rejects(() => useCase.execute({ user: clienteUser, cotizacionId: 'cot-1', accion: 'RECHAZAR', motivo: 'Ya no quiero' }), (e) => e.statusCode === 409);
});

test('dos respuestas simultáneas: solo una gana y la otra recibe 409', async () => {
  const { useCase } = await setup();

  const results = await Promise.allSettled([
    useCase.execute({ user: clienteUser, cotizacionId: 'cot-1', accion: 'ACEPTAR' }),
    useCase.execute({ user: clienteUser, cotizacionId: 'cot-1', accion: 'RECHAZAR', motivo: 'Muy costosa' }),
  ]);

  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(results.find((r) => r.status === 'rejected').reason.statusCode, 409);
});

test('compara solicitud.cliente_id con cliente.id, no con el id del usuario: otro cliente recibe 403', async () => {
  const { useCase } = await setup({ solicitud: { clienteId: 'cliente-2' } });

  await assert.rejects(() => useCase.execute({ user: clienteUser, cotizacionId: 'cot-1', accion: 'ACEPTAR' }), (e) => e.statusCode === 403);
});

test('un usuario sin perfil de cliente en el tenant recibe 403', async () => {
  const { useCase } = await setup({ cliente: null });

  await assert.rejects(() => useCase.execute({ user: clienteUser, cotizacionId: 'cot-1', accion: 'ACEPTAR' }), (e) => e.statusCode === 403);
});

test('cross-tenant: la cotización de otro tenant no existe (404) y no cambia', async () => {
  const { useCase, cotizacionRepository } = await setup({ cotizacion: { tenantId: 'tenant-b' } });

  await assert.rejects(() => useCase.execute({ user: clienteUser, cotizacionId: 'cot-1', accion: 'ACEPTAR' }), (e) => e.statusCode === 404);
  assert.equal((await cotizacionRepository.findById({ tenantId: 'tenant-b' }, 'cot-1')).estado, 'PENDIENTE');
});

test('cotización inexistente responde 404', async () => {
  const { useCase } = await setup();

  await assert.rejects(() => useCase.execute({ user: clienteUser, cotizacionId: 'no-existe', accion: 'ACEPTAR' }), (e) => e.statusCode === 404);
});

for (const [name, input] of [
  ['acción desconocida', { accion: 'BORRAR' }],
  ['rechazo sin motivo', { accion: 'RECHAZAR', motivo: 'no' }],
  ['ajuste sin comentario', { accion: 'AJUSTAR', comentario: '' }],
  ['sin cotización', { accion: 'ACEPTAR', cotizacionId: '' }],
]) {
  test(`validación: ${name} responde 400`, async () => {
    const { useCase } = await setup();

    await assert.rejects(() => useCase.execute({ user: clienteUser, cotizacionId: 'cot-1', ...input }), (e) => e.statusCode === 400);
  });
}

test('un aliado o una sesión sin tenant no puede responder (403)', async () => {
  const { useCase } = await setup();

  await assert.rejects(() => useCase.execute({ user: { ...clienteUser, role: 'ALLY' }, cotizacionId: 'cot-1', accion: 'ACEPTAR' }), (e) => e.statusCode === 403);
  await assert.rejects(() => useCase.execute({ user: { userId: 'x', role: 'CLIENT' }, cotizacionId: 'cot-1', accion: 'ACEPTAR' }), (e) => e.statusCode === 403);
});

test('exige sus dependencias', () => {
  assert.throws(() => new RespondQuoteUseCase({}), /cotizacionRepository/);
  assert.throws(() => new RespondQuoteUseCase({ cotizacionRepository: {} }), /solicitudRepository/);
  assert.throws(() => new RespondQuoteUseCase({ cotizacionRepository: {}, solicitudRepository: {} }), /eventoServicioRepository/);
  assert.throws(() => new RespondQuoteUseCase({ cotizacionRepository: {}, solicitudRepository: {}, eventoServicioRepository: {} }), /clienteRepository/);
});
