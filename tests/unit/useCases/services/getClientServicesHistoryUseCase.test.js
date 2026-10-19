const test = require('node:test');
const assert = require('node:assert/strict');
const GetClientServicesHistoryUseCase = require('../../../../src/application/useCases/services/GetClientServicesHistoryUseCase');
const InMemorySolicitudRepository = require('../../../../src/infrastructure/repositories/InMemorySolicitudRepository');
const InMemoryCotizacionRepository = require('../../../../src/infrastructure/repositories/InMemoryCotizacionRepository');

const TENANT = 'tenant-a';
const cliente = { userId: 'u-cliente', tenantId: TENANT, role: 'CLIENT' };
const base = { categoriaId: 'c', zonaId: 'z', aliadoId: 'aliado-1' };

async function setup() {
  const solicitudRepository = new InMemorySolicitudRepository();
  const cotizacionRepository = new InMemoryCotizacionRepository();
  solicitudRepository.seed({ ...base, id: 's1', tenantId: TENANT, clienteId: 'cliente-1', estado: 'FINALIZADA', fechaCreacion: '2026-10-01T00:00:00Z' });
  solicitudRepository.seed({ ...base, id: 's2', tenantId: TENANT, clienteId: 'cliente-1', estado: 'COTIZANDO', fechaCreacion: '2026-10-02T00:00:00Z' });
  solicitudRepository.seed({ ...base, id: 's3', tenantId: TENANT, clienteId: 'cliente-2', estado: 'FINALIZADA' });
  solicitudRepository.seed({ ...base, id: 's4', tenantId: 'tenant-b', clienteId: 'cliente-1', estado: 'FINALIZADA' });
  const ctx = { tenantId: TENANT };
  await cotizacionRepository.create(ctx, { solicitudId: 's1', aliadoId: 'aliado-1', valorManoObra: 100, estado: 'RECHAZADA', version: 1 });
  await cotizacionRepository.create(ctx, { solicitudId: 's1', aliadoId: 'aliado-1', valorManoObra: 90, estado: 'ACEPTADA', version: 2 });
  await cotizacionRepository.create(ctx, { solicitudId: 's2', aliadoId: 'aliado-1', valorManoObra: 50, estado: 'PENDIENTE', version: 1 });
  await cotizacionRepository.create(ctx, { solicitudId: 's2', aliadoId: 'aliado-1', valorManoObra: 60, estado: 'PENDIENTE', version: 2 });
  const clienteRepository = { findByUsuarioId: async (t, u) => (t === TENANT && u === 'u-cliente' ? { id: 'cliente-1' } : null) };
  return new GetClientServicesHistoryUseCase({ solicitudRepository, cotizacionRepository, clienteRepository });
}

test('lista solo las solicitudes de su cliente.id en su tenant, de la más reciente a la más antigua, con la cotización final', async () => {
  const useCase = await setup();

  const { servicios, total } = await useCase.execute({ user: cliente });

  assert.equal(total, 2);
  assert.deepEqual(servicios.map((s) => s.id), ['s2', 's1']);
  assert.equal(servicios[1].cotizacion.estado, 'ACEPTADA');
  assert.equal(servicios[1].cotizacion.version, 2);
  assert.equal(servicios[0].cotizacion.version, 2);
});

test('filtra por estado (sin distinguir mayúsculas)', async () => {
  const useCase = await setup();

  const { servicios } = await useCase.execute({ user: cliente, estado: ' finalizada ' });

  assert.deepEqual(servicios.map((s) => s.id), ['s1']);
});

test('un cliente sin perfil en el tenant, un aliado o una sesión sin tenant reciben 403', async () => {
  const useCase = await setup();

  await assert.rejects(() => useCase.execute({ user: { ...cliente, userId: 'otro' } }), (e) => e.statusCode === 403);
  await assert.rejects(() => useCase.execute({ user: { ...cliente, role: 'ALLY' } }), (e) => e.statusCode === 403);
  await assert.rejects(() => useCase.execute({ user: { userId: 'u-cliente', role: 'CLIENT' } }), (e) => e.statusCode === 403);
});

test('exige sus dependencias', () => {
  assert.throws(() => new GetClientServicesHistoryUseCase({}), /solicitudRepository/);
  assert.throws(() => new GetClientServicesHistoryUseCase({ solicitudRepository: {} }), /cotizacionRepository/);
  assert.throws(() => new GetClientServicesHistoryUseCase({ solicitudRepository: {}, cotizacionRepository: {} }), /clienteRepository/);
});
