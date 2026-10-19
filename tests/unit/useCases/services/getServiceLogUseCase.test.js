const test = require('node:test');
const assert = require('node:assert/strict');
const GetServiceLogUseCase = require('../../../../src/application/useCases/services/GetServiceLogUseCase');
const InMemorySolicitudRepository = require('../../../../src/infrastructure/repositories/InMemorySolicitudRepository');
const InMemoryEventoServicioRepository = require('../../../../src/infrastructure/repositories/InMemoryEventoServicioRepository');

const TENANT = 'tenant-a';
const users = {
  cliente: { userId: 'u-cliente', tenantId: TENANT, role: 'CLIENT' },
  aliado: { userId: 'u-aliado', tenantId: TENANT, role: 'ALLY' },
  admin: { userId: 'u-admin', tenantId: TENANT, role: 'ADMIN' },
};

async function setup({ solicitud = {}, eventos = [] } = {}) {
  const solicitudRepository = new InMemorySolicitudRepository();
  const eventoServicioRepository = new InMemoryEventoServicioRepository();
  solicitudRepository.seed({
    id: 'sol-1', tenantId: TENANT, clienteId: 'cliente-1', categoriaId: 'c', zonaId: 'z', aliadoId: 'aliado-1', estado: 'EN_EJECUCION',
    fechaCreacion: '2026-10-18T08:00:00.000Z', ...solicitud,
  });
  for (const e of eventos) await eventoServicioRepository.create({ tenantId: TENANT }, { solicitudId: 'sol-1', actorId: 'u-aliado', ...e });
  const clienteRepository = { findByUsuarioId: async (t, u) => (t === TENANT && u === 'u-cliente' ? { id: 'cliente-1' } : null) };
  const aliadoRepository = { findByUsuarioId: async (t, u) => (t === TENANT && u === 'u-aliado' ? { id: 'aliado-1' } : null) };
  return new GetServiceLogUseCase({ solicitudRepository, eventoServicioRepository, clienteRepository, aliadoRepository });
}

test('el cliente dueño, el aliado asignado y el administrador ven el log en orden cronológico', async () => {
  const useCase = await setup({ eventos: [{ tipoEvento: 'INICIO_EJECUCION', descripcion: 'Llegada' }, { tipoEvento: 'EVENTO_EJECUCION', descripcion: 'Imprevisto' }] });

  for (const user of Object.values(users)) {
    const { log } = await useCase.execute({ user, solicitudId: 'sol-1' });
    assert.deepEqual(log.map((e) => e.tipoEvento), ['INICIO_EJECUCION', 'EVENTO_EJECUCION']);
  }
});

test('sin eventos devuelve el registro de creación con la fecha de la solicitud', async () => {
  const useCase = await setup();

  const { log } = await useCase.execute({ user: users.cliente, solicitudId: 'sol-1' });

  assert.deepEqual(log, [{
    id: null, solicitudId: 'sol-1', actorId: null, tipoEvento: 'SOLICITUD_CREADA', descripcion: 'Solicitud de servicio registrada', evidenciaRuta: null, fecha: '2026-10-18T08:00:00.000Z',
  }]);
});

test('compara con cliente.id y aliado.id: otro cliente u otro aliado reciben 403', async () => {
  const deOtro = await setup({ solicitud: { clienteId: 'cliente-2', aliadoId: 'aliado-2' } });

  await assert.rejects(() => deOtro.execute({ user: users.cliente, solicitudId: 'sol-1' }), (e) => e.statusCode === 403);
  await assert.rejects(() => deOtro.execute({ user: users.aliado, solicitudId: 'sol-1' }), (e) => e.statusCode === 403);
  await assert.rejects(() => deOtro.execute({ user: { ...users.cliente, userId: 'sin-perfil' }, solicitudId: 'sol-1' }), (e) => e.statusCode === 403);
});

test('cross-tenant: la solicitud de otro tenant no existe (404)', async () => {
  const useCase = await setup({ solicitud: { tenantId: 'tenant-b' } });

  await assert.rejects(() => useCase.execute({ user: users.admin, solicitudId: 'sol-1' }), (e) => e.statusCode === 404);
});

test('sin sesión, rol desconocido o sin solicitud no pasa', async () => {
  const useCase = await setup();

  await assert.rejects(() => useCase.execute({ user: null, solicitudId: 'sol-1' }), (e) => e.statusCode === 403);
  await assert.rejects(() => useCase.execute({ user: { ...users.admin, role: 'OTRO' }, solicitudId: 'sol-1' }), (e) => e.statusCode === 403);
  await assert.rejects(() => useCase.execute({ user: users.admin, solicitudId: '' }), (e) => e.statusCode === 400);
});

test('exige sus dependencias', () => {
  assert.throws(() => new GetServiceLogUseCase({}), /solicitudRepository/);
  assert.throws(() => new GetServiceLogUseCase({ solicitudRepository: {} }), /eventoServicioRepository/);
  assert.throws(() => new GetServiceLogUseCase({ solicitudRepository: {}, eventoServicioRepository: {} }), /clienteRepository/);
  assert.throws(() => new GetServiceLogUseCase({ solicitudRepository: {}, eventoServicioRepository: {}, clienteRepository: {} }), /aliadoRepository/);
});
