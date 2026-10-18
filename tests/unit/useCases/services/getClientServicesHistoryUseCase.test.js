const test = require('node:test');
const assert = require('node:assert/strict');

const GetClientServicesHistoryUseCase = require('../../../../src/application/useCases/services/GetClientServicesHistoryUseCase');
const InMemorySolicitudRepository = require('../../../../src/infrastructure/repositories/InMemorySolicitudRepository');
const InMemoryCotizacionRepository = require('../../../../src/infrastructure/repositories/InMemoryCotizacionRepository');
const Solicitud = require('../../../../src/domain/entities/Solicitud');
const Cotizacion = require('../../../../src/domain/entities/Cotizacion');

test('GetClientServicesHistoryUseCase - validaciones del constructor', () => {
  assert.throws(() => new GetClientServicesHistoryUseCase({}), /solicitudRepository es requerido/);
});

test('GetClientServicesHistoryUseCase - rechaza si falta sesión o el rol no es CLIENT', async () => {
  const useCase = new GetClientServicesHistoryUseCase({
    solicitudRepository: new InMemorySolicitudRepository(),
  });

  await assert.rejects(
    () => useCase.execute({ user: null }),
    { statusCode: 403, message: 'Sesión requerida' }
  );

  await assert.rejects(
    () => useCase.execute({ user: { userId: 'u-1', tenantId: 'trama-demo', role: 'ALLY' } }),
    { statusCode: 403, message: /Solo los clientes/ }
  );
});

test('GetClientServicesHistoryUseCase - retorna lista vacía si el cliente no tiene servicios', async () => {
  const useCase = new GetClientServicesHistoryUseCase({
    solicitudRepository: new InMemorySolicitudRepository(),
  });

  const user = { userId: 'cliente-sin-servicios', tenantId: 'trama-demo', role: 'CLIENT' };
  const res = await useCase.execute({ user });

  assert.equal(res.total, 0);
  assert.deepEqual(res.servicios, []);
});

test('GetClientServicesHistoryUseCase - retorna historial con cotizaciones y respeta filtro por estado', async () => {
  const solicitudRepo = new InMemorySolicitudRepository();
  const cotizacionRepo = new InMemoryCotizacionRepository();
  const useCase = new GetClientServicesHistoryUseCase({
    solicitudRepository: solicitudRepo,
    cotizacionRepository: cotizacionRepo,
  });

  const clienteId = 'cliente-vip';
  const sol1 = await solicitudRepo.create(
    new Solicitud({
      tenantId: 'trama-demo',
      clienteId,
      aliadoId: 'aliado-1',
      categoriaId: 'cat-plomeria',
      zonaId: 'z-1',
      descripcion: 'Arreglo fuga cocina',
      estado: 'FINALIZADA',
      fechaCreacion: '2026-10-10T10:00:00Z',
    })
  );

  const sol2 = await solicitudRepo.create(
    new Solicitud({
      tenantId: 'trama-demo',
      clienteId,
      aliadoId: 'aliado-2',
      categoriaId: 'cat-electricidad',
      zonaId: 'z-1',
      descripcion: 'Instalación lámpara',
      estado: 'EN_EJECUCION',
      fechaCreacion: '2026-10-15T10:00:00Z',
    })
  );

  // Solicitud de otro tenant (no debe aparecer)
  await solicitudRepo.create(
    new Solicitud({
      tenantId: 'otro-tenant',
      clienteId,
      categoriaId: 'cat-cerrajeria',
      zonaId: 'z-2',
      descripcion: 'Cambio de chapa',
      estado: 'FINALIZADA',
    })
  );

  // Cotización asociada a sol1
  await cotizacionRepo.create(
    new Cotizacion({
      solicitudId: sol1.id,
      aliadoId: 'aliado-1',
      valorManoObra: 60000,
      valorMateriales: 20000,
      valor: 80000,
      estado: 'ACEPTADA',
    })
  );

  const user = { userId: clienteId, tenantId: 'trama-demo', role: 'CLIENT' };

  // 1. Consulta todo el historial
  const resTodos = await useCase.execute({ user });
  assert.equal(resTodos.total, 2);
  assert.equal(resTodos.servicios[0].id, sol2.id); // Más reciente primero
  assert.equal(resTodos.servicios[1].id, sol1.id);
  assert.ok(resTodos.servicios[1].cotizacion);
  assert.equal(resTodos.servicios[1].cotizacion.valor, 80000);

  // 2. Consulta filtrando por estado FINALIZADA
  const resFiltrado = await useCase.execute({ user, estado: 'FINALIZADA' });
  assert.equal(resFiltrado.total, 1);
  assert.equal(resFiltrado.servicios[0].id, sol1.id);
  assert.equal(resFiltrado.servicios[0].estado, 'FINALIZADA');
});
