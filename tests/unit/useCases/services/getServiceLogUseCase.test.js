const test = require('node:test');
const assert = require('node:assert/strict');

const GetServiceLogUseCase = require('../../../../src/application/useCases/services/GetServiceLogUseCase');
const InMemorySolicitudRepository = require('../../../../src/infrastructure/repositories/InMemorySolicitudRepository');
const InMemoryHistorialSolicitudRepository = require('../../../../src/infrastructure/repositories/InMemoryHistorialSolicitudRepository');
const Solicitud = require('../../../../src/domain/entities/Solicitud');

test('GetServiceLogUseCase - validaciones del constructor', () => {
  assert.throws(() => new GetServiceLogUseCase({}), /solicitudRepository es requerido/);
  assert.throws(
    () => new GetServiceLogUseCase({ solicitudRepository: {} }),
    /historialSolicitudRepository es requerido/
  );
});

test('GetServiceLogUseCase - rechaza si falta sesión o solicitudId', async () => {
  const useCase = new GetServiceLogUseCase({
    solicitudRepository: new InMemorySolicitudRepository(),
    historialSolicitudRepository: new InMemoryHistorialSolicitudRepository(),
  });

  await assert.rejects(
    () => useCase.execute({ user: null, solicitudId: 'sol-1' }),
    { statusCode: 403, message: 'Sesión requerida' }
  );

  await assert.rejects(
    () =>
      useCase.execute({
        user: { userId: 'c-1', tenantId: 'trama-demo', role: 'CLIENT' },
        solicitudId: '',
      }),
    { statusCode: 400, message: 'El id de la solicitud es obligatorio' }
  );
});

test('GetServiceLogUseCase - rechaza solicitud inexistente o de otro tenant', async () => {
  const useCase = new GetServiceLogUseCase({
    solicitudRepository: new InMemorySolicitudRepository(),
    historialSolicitudRepository: new InMemoryHistorialSolicitudRepository(),
  });
  const user = { userId: 'demo-client-1', tenantId: 'trama-demo', role: 'CLIENT' };

  await assert.rejects(
    () => useCase.execute({ user, solicitudId: 'sol-no-existe' }),
    { statusCode: 404, message: 'Solicitud no encontrada' }
  );

  const userOtroTenant = { userId: 'demo-client-1', tenantId: 'otro-tenant', role: 'CLIENT' };
  await assert.rejects(
    () => useCase.execute({ user: userOtroTenant, solicitudId: 'sol-demo-1' }),
    { statusCode: 404, message: 'Solicitud no encontrada' }
  );
});

test('GetServiceLogUseCase - rechaza si cliente consulta solicitud ajena (403)', async () => {
  const useCase = new GetServiceLogUseCase({
    solicitudRepository: new InMemorySolicitudRepository(),
    historialSolicitudRepository: new InMemoryHistorialSolicitudRepository(),
  });

  const clienteAjeno = { userId: 'cliente-ajeno', tenantId: 'trama-demo', role: 'CLIENT' };
  await assert.rejects(
    () => useCase.execute({ user: clienteAjeno, solicitudId: 'sol-demo-1' }),
    { statusCode: 403, message: /solicitud ajena/ }
  );
});

test('GetServiceLogUseCase - entrega historial cronológico completo de la solicitud', async () => {
  const solicitudRepo = new InMemorySolicitudRepository();
  const historialRepo = new InMemoryHistorialSolicitudRepository();
  const useCase = new GetServiceLogUseCase({
    solicitudRepository: solicitudRepo,
    historialSolicitudRepository: historialRepo,
  });

  const sol = await solicitudRepo.create(
    new Solicitud({
      tenantId: 'trama-demo',
      clienteId: 'cliente-123',
      aliadoId: 'aliado-456',
      categoriaId: 'cat-plomeria',
      zonaId: 'zona-norte',
      descripcion: 'Reparación tubería',
      estado: 'EN_EJECUCION',
    })
  );

  await historialRepo.create({
    solicitudId: sol.id,
    usuarioId: 'aliado-456',
    estadoAnterior: 'ASIGNADA',
    estadoNuevo: 'COTIZANDO',
    observacion: 'Cotización inicial enviada',
    fecha: '2026-10-18T10:00:00Z',
  });

  await historialRepo.create({
    solicitudId: sol.id,
    usuarioId: 'cliente-123',
    estadoAnterior: 'COTIZANDO',
    estadoNuevo: 'ACEPTADA',
    observacion: 'Cliente aceptó la cotización',
    fecha: '2026-10-18T10:15:00Z',
  });

  await historialRepo.create({
    solicitudId: sol.id,
    usuarioId: 'aliado-456',
    estadoAnterior: 'ACEPTADA',
    estadoNuevo: 'EN_EJECUCION',
    observacion: 'Aliado llegó al sitio e inició la reparación',
    fecha: '2026-10-18T11:00:00Z',
  });

  const user = { userId: 'cliente-123', tenantId: 'trama-demo', role: 'CLIENT' };
  const res = await useCase.execute({ user, solicitudId: sol.id });

  assert.equal(res.solicitud.id, sol.id);
  assert.equal(res.log.length, 3);
  assert.equal(res.log[0].estadoNuevo, 'COTIZANDO');
  assert.equal(res.log[1].estadoNuevo, 'ACEPTADA');
  assert.equal(res.log[2].estadoNuevo, 'EN_EJECUCION');
  assert.ok(new Date(res.log[0].fecha) < new Date(res.log[1].fecha));
});
