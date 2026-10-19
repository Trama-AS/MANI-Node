const test = require('node:test');
const assert = require('node:assert/strict');
const CreateQuoteUseCase = require('../../../../src/application/useCases/quotes/CreateQuoteUseCase');
const InMemoryCotizacionRepository = require('../../../../src/infrastructure/repositories/InMemoryCotizacionRepository');
const InMemorySolicitudRepository = require('../../../../src/infrastructure/repositories/InMemorySolicitudRepository');
const InMemoryEventoServicioRepository = require('../../../../src/infrastructure/repositories/InMemoryEventoServicioRepository');

const TENANT = 'tenant-a';
const ally = { userId: 'usuario-aliado-1', tenantId: TENANT, role: 'ALLY' };

function setup({ aliado = { id: 'aliado-1', usuarioId: 'usuario-aliado-1', tenantId: TENANT }, solicitud = {} } = {}) {
  const cotizacionRepository = new InMemoryCotizacionRepository();
  const solicitudRepository = new InMemorySolicitudRepository();
  const eventoServicioRepository = new InMemoryEventoServicioRepository();
  solicitudRepository.seed({
    id: 'sol-1',
    tenantId: TENANT,
    clienteId: 'cliente-1',
    categoriaId: 'cat-1',
    zonaId: 'zona-1',
    aliadoId: 'aliado-1',
    estado: 'ASIGNADA',
    ...solicitud,
  });
  const aliadoRepository = {
    findByUsuarioId: async (tenantId, usuarioId) =>
      aliado && aliado.tenantId === tenantId && aliado.usuarioId === usuarioId ? aliado : null,
  };
  const useCase = new CreateQuoteUseCase({ cotizacionRepository, solicitudRepository, eventoServicioRepository, aliadoRepository });
  return { useCase, cotizacionRepository, solicitudRepository, eventoServicioRepository };
}

test('emite la cotización con mano de obra y materiales separados, guarda aliado.id y registra el evento', async () => {
  const { useCase, solicitudRepository, eventoServicioRepository } = setup();

  const result = await useCase.execute({ user: ally, solicitudId: 'sol-1', valorManoObra: 65000, valorMateriales: 15000.456, observacion: '  Repuestos  ' });

  assert.equal(result.cotizacion.aliadoId, 'aliado-1');
  assert.equal(result.cotizacion.tenantId, TENANT);
  assert.equal(result.cotizacion.valorManoObra, 65000);
  assert.equal(result.cotizacion.valorMateriales, 15000.46);
  assert.equal(result.cotizacion.valor, 80000.46);
  assert.equal(result.cotizacion.version, 1);
  assert.equal(result.cotizacion.observacion, 'Repuestos');
  assert.equal(result.validacionTarifario, 'PENDIENTE');
  assert.equal((await solicitudRepository.findById({ tenantId: TENANT }, 'sol-1')).estado, 'COTIZANDO');
  const eventos = await eventoServicioRepository.findBySolicitudId({ tenantId: TENANT }, 'sol-1');
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].tipoEvento, 'COTIZACION_ENVIADA');
  assert.equal(eventos[0].actorId, 'usuario-aliado-1');
});

test('una segunda cotización incrementa la versión', async () => {
  const { useCase } = setup();
  await useCase.execute({ user: ally, solicitudId: 'sol-1', valorManoObra: 1000 });

  const segunda = await useCase.execute({ user: ally, solicitudId: 'sol-1', valorManoObra: 2000 });

  assert.equal(segunda.cotizacion.version, 2);
});

test('montos altos no se marcan fuera de rango en Core: el tarifario queda PENDIENTE de Rules', async () => {
  const { useCase } = setup();

  const result = await useCase.execute({ user: ally, solicitudId: 'sol-1', valorManoObra: 5000000 });

  assert.equal(result.validacionTarifario, 'PENDIENTE');
  assert.equal(result.cotizacion.valor, 5000000);
});

for (const [name, input, code] of [
  ['sin mano de obra', { valorManoObra: undefined }, 400],
  ['mano de obra no numérica', { valorManoObra: 'abc' }, 400],
  ['mano de obra negativa', { valorManoObra: -1 }, 400],
  ['materiales negativos', { valorManoObra: 10, valorMateriales: -1 }, 400],
  ['total que no cuadra', { valorManoObra: 10, valorMateriales: 5, valor: 20 }, 400],
  ['sin solicitud', { valorManoObra: 10, solicitudId: '' }, 400],
]) {
  test(`validación: ${name} responde ${code}`, async () => {
    const { useCase, cotizacionRepository } = setup();

    await assert.rejects(
      () => useCase.execute({ user: ally, solicitudId: 'sol-1', ...input }),
      (err) => err.statusCode === code
    );
    assert.equal((await cotizacionRepository.findBySolicitudId({ tenantId: TENANT }, 'sol-1')).length, 0);
  });
}

test('un cliente o una sesión sin tenant no puede cotizar (403)', async () => {
  const { useCase } = setup();

  await assert.rejects(() => useCase.execute({ user: { ...ally, role: 'CLIENT' }, solicitudId: 'sol-1', valorManoObra: 1 }), (e) => e.statusCode === 403);
  await assert.rejects(() => useCase.execute({ user: { userId: 'x', role: 'ALLY' }, solicitudId: 'sol-1', valorManoObra: 1 }), (e) => e.statusCode === 403);
});

test('un usuario sin perfil de aliado en el tenant recibe 403', async () => {
  const { useCase } = setup({ aliado: null });

  await assert.rejects(() => useCase.execute({ user: ally, solicitudId: 'sol-1', valorManoObra: 1 }), (e) => e.statusCode === 403);
});

test('cross-tenant: la solicitud de otro tenant no existe (404) y no se escribe nada', async () => {
  const { useCase, cotizacionRepository } = setup({ solicitud: { tenantId: 'tenant-b' } });

  await assert.rejects(() => useCase.execute({ user: ally, solicitudId: 'sol-1', valorManoObra: 1 }), (e) => e.statusCode === 404);
  assert.equal((await cotizacionRepository.findBySolicitudId({ tenantId: 'tenant-b' }, 'sol-1')).length, 0);
});

test('una solicitud asignada a otro aliado responde 403', async () => {
  const { useCase } = setup({ solicitud: { aliadoId: 'aliado-2' } });

  await assert.rejects(() => useCase.execute({ user: ally, solicitudId: 'sol-1', valorManoObra: 1 }), (e) => e.statusCode === 403);
});

test('una solicitud sin asignar responde 409: Core no asigna (ADR-0016)', async () => {
  const { useCase } = setup({ solicitud: { aliadoId: null, estado: 'PENDIENTE' } });

  await assert.rejects(() => useCase.execute({ user: ally, solicitudId: 'sol-1', valorManoObra: 1 }), (e) => e.statusCode === 409);
});

for (const estado of ['FINALIZADA', 'CANCELADA', 'RECHAZADA']) {
  test(`una solicitud ${estado} responde 409`, async () => {
    const { useCase } = setup({ solicitud: { estado } });

    await assert.rejects(() => useCase.execute({ user: ally, solicitudId: 'sol-1', valorManoObra: 1 }), (e) => e.statusCode === 409);
  });
}

test('exige sus dependencias', () => {
  assert.throws(() => new CreateQuoteUseCase({}), /cotizacionRepository/);
  assert.throws(() => new CreateQuoteUseCase({ cotizacionRepository: {} }), /solicitudRepository/);
  assert.throws(() => new CreateQuoteUseCase({ cotizacionRepository: {}, solicitudRepository: {} }), /eventoServicioRepository/);
  assert.throws(
    () => new CreateQuoteUseCase({ cotizacionRepository: {}, solicitudRepository: {}, eventoServicioRepository: {} }),
    /aliadoRepository/
  );
});
