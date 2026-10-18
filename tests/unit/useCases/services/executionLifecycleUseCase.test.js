const test = require('node:test');
const assert = require('node:assert/strict');

const ExecutionLifecycleUseCase = require('../../../../src/application/useCases/services/ExecutionLifecycleUseCase');
const InMemorySolicitudRepository = require('../../../../src/infrastructure/repositories/InMemorySolicitudRepository');
const InMemoryHistorialSolicitudRepository = require('../../../../src/infrastructure/repositories/InMemoryHistorialSolicitudRepository');
const Solicitud = require('../../../../src/domain/entities/Solicitud');

test('ExecutionLifecycleUseCase - validaciones del constructor', () => {
  assert.throws(() => new ExecutionLifecycleUseCase({}), /solicitudRepository es requerido/);
  assert.throws(
    () => new ExecutionLifecycleUseCase({ solicitudRepository: {} }),
    /historialSolicitudRepository es requerido/
  );
});

test('ExecutionLifecycleUseCase - startExecution rechaza si falta sesión o el rol no es ALLY', async () => {
  const useCase = new ExecutionLifecycleUseCase({
    solicitudRepository: new InMemorySolicitudRepository(),
    historialSolicitudRepository: new InMemoryHistorialSolicitudRepository(),
  });

  await assert.rejects(
    () => useCase.startExecution({ user: null, solicitudId: 'sol-1' }),
    { statusCode: 403, message: 'Sesión requerida' }
  );

  await assert.rejects(
    () =>
      useCase.startExecution({
        user: { userId: 'u-1', tenantId: 'trama-demo', role: 'CLIENT' },
        solicitudId: 'sol-1',
      }),
    { statusCode: 403, message: /Solo el aliado/ }
  );
});

test('ExecutionLifecycleUseCase - startExecution valida solicitudId, existencia y tenant', async () => {
  const useCase = new ExecutionLifecycleUseCase({
    solicitudRepository: new InMemorySolicitudRepository(),
    historialSolicitudRepository: new InMemoryHistorialSolicitudRepository(),
  });
  const user = { userId: 'demo-ally-1', tenantId: 'trama-demo', role: 'ALLY' };

  await assert.rejects(
    () => useCase.startExecution({ user, solicitudId: '' }),
    { statusCode: 400, message: 'El id de la solicitud es obligatorio' }
  );

  await assert.rejects(
    () => useCase.startExecution({ user, solicitudId: 'sol-no-existe' }),
    { statusCode: 404, message: 'Solicitud no encontrada' }
  );

  const userOtroTenant = { userId: 'demo-ally-1', tenantId: 'otro-tenant', role: 'ALLY' };
  await assert.rejects(
    () => useCase.startExecution({ user: userOtroTenant, solicitudId: 'sol-demo-1' }),
    { statusCode: 404, message: 'Solicitud no encontrada' }
  );
});

test('ExecutionLifecycleUseCase - startExecution rechaza si pertenece a otro aliado o repetición (409)', async () => {
  const solicitudRepo = new InMemorySolicitudRepository();
  const useCase = new ExecutionLifecycleUseCase({
    solicitudRepository: solicitudRepo,
    historialSolicitudRepository: new InMemoryHistorialSolicitudRepository(),
  });

  const userAjeno = { userId: 'aliado-ajeno', tenantId: 'trama-demo', role: 'ALLY' };
  await assert.rejects(
    () => useCase.startExecution({ user: userAjeno, solicitudId: 'sol-demo-1' }),
    { statusCode: 403, message: /asignado a otro aliado/ }
  );

  const solEnEjecucion = await solicitudRepo.create(
    new Solicitud({
      tenantId: 'trama-demo',
      clienteId: 'c-1',
      aliadoId: 'demo-ally-1',
      categoriaId: 'cat-1',
      zonaId: 'z-1',
      descripcion: 'Trabajo en curso',
      estado: 'EN_EJECUCION',
    })
  );

  const userCorrecto = { userId: 'demo-ally-1', tenantId: 'trama-demo', role: 'ALLY' };
  await assert.rejects(
    () => useCase.startExecution({ user: userCorrecto, solicitudId: solEnEjecucion.id }),
    { statusCode: 409, message: /ya fue iniciada previamente/ }
  );
});

test('ExecutionLifecycleUseCase - startExecution exitoso: cambia a EN_EJECUCION y registra fechaInicio', async () => {
  const solicitudRepo = new InMemorySolicitudRepository();
  const historialRepo = new InMemoryHistorialSolicitudRepository();
  const useCase = new ExecutionLifecycleUseCase({
    solicitudRepository: solicitudRepo,
    historialSolicitudRepository: historialRepo,
  });

  const user = { userId: 'demo-ally-1', tenantId: 'trama-demo', role: 'ALLY' };
  const res = await useCase.startExecution({
    user,
    solicitudId: 'sol-demo-1',
    observacion: 'Llegué al domicilio del cliente',
  });

  assert.equal(res.solicitud.estado, 'EN_EJECUCION');
  assert.ok(res.solicitud.fechaInicioEjecucion);

  const eventos = await historialRepo.findBySolicitudId('sol-demo-1');
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].estadoNuevo, 'EN_EJECUCION');
  assert.ok(eventos[0].observacion.includes('Llegué al domicilio'));
});

test('ExecutionLifecycleUseCase - finishExecution rechaza fin sin inicio (409 Conflict)', async () => {
  const solicitudRepo = new InMemorySolicitudRepository();
  const useCase = new ExecutionLifecycleUseCase({
    solicitudRepository: solicitudRepo,
    historialSolicitudRepository: new InMemoryHistorialSolicitudRepository(),
  });

  const user = { userId: 'demo-ally-1', tenantId: 'trama-demo', role: 'ALLY' };

  // sol-demo-1 está en estado ASIGNADA (no iniciada)
  await assert.rejects(
    () => useCase.finishExecution({ user, solicitudId: 'sol-demo-1' }),
    { statusCode: 409, message: 'No se puede finalizar un servicio que no ha sido iniciado' }
  );
});

test('ExecutionLifecycleUseCase - finishExecution exitoso: transiciona a FINALIZADA y registra fechaFin', async () => {
  const solicitudRepo = new InMemorySolicitudRepository();
  const historialRepo = new InMemoryHistorialSolicitudRepository();
  const useCase = new ExecutionLifecycleUseCase({
    solicitudRepository: solicitudRepo,
    historialSolicitudRepository: historialRepo,
  });

  const user = { userId: 'demo-ally-1', tenantId: 'trama-demo', role: 'ALLY' };

  // Iniciar primero
  await useCase.startExecution({ user, solicitudId: 'sol-demo-1' });

  // Finalizar
  const res = await useCase.finishExecution({
    user,
    solicitudId: 'sol-demo-1',
    observacion: 'Trabajo de plomería completado y probado',
  });

  assert.equal(res.solicitud.estado, 'FINALIZADA');
  assert.ok(res.solicitud.fechaFinEjecucion);

  const eventos = await historialRepo.findBySolicitudId('sol-demo-1');
  assert.equal(eventos.length, 2);
  assert.equal(eventos[1].estadoNuevo, 'FINALIZADA');
  assert.ok(eventos[1].observacion.includes('completado'));

  // Repetición al intentar finalizar de nuevo (409)
  await assert.rejects(
    () => useCase.finishExecution({ user, solicitudId: 'sol-demo-1' }),
    { statusCode: 409, message: 'El servicio ya se encuentra finalizado' }
  );
});
