const test = require('node:test');
const assert = require('node:assert/strict');

const RespondQuoteUseCase = require('../../../../src/application/useCases/quotes/RespondQuoteUseCase');
const InMemoryCotizacionRepository = require('../../../../src/infrastructure/repositories/InMemoryCotizacionRepository');
const InMemorySolicitudRepository = require('../../../../src/infrastructure/repositories/InMemorySolicitudRepository');
const InMemoryHistorialSolicitudRepository = require('../../../../src/infrastructure/repositories/InMemoryHistorialSolicitudRepository');
const Cotizacion = require('../../../../src/domain/entities/Cotizacion');
const Solicitud = require('../../../../src/domain/entities/Solicitud');

test('RespondQuoteUseCase - validaciones del constructor', () => {
  assert.throws(() => new RespondQuoteUseCase({}), /cotizacionRepository es requerido/);
  assert.throws(
    () => new RespondQuoteUseCase({ cotizacionRepository: {} }),
    /solicitudRepository es requerido/
  );
  assert.throws(
    () => new RespondQuoteUseCase({ cotizacionRepository: {}, solicitudRepository: {} }),
    /historialSolicitudRepository es requerido/
  );
});

test('RespondQuoteUseCase - rechaza si falta sesión o el rol no es CLIENT', async () => {
  const useCase = new RespondQuoteUseCase({
    cotizacionRepository: new InMemoryCotizacionRepository(),
    solicitudRepository: new InMemorySolicitudRepository(),
    historialSolicitudRepository: new InMemoryHistorialSolicitudRepository(),
  });

  await assert.rejects(
    () => useCase.execute({ user: null, cotizacionId: 'cot-1', accion: 'ACEPTAR' }),
    { statusCode: 403, message: 'Sesión requerida' }
  );

  await assert.rejects(
    () =>
      useCase.execute({
        user: { userId: 'u-1', tenantId: 'trama-demo', role: 'ALLY' },
        cotizacionId: 'cot-1',
        accion: 'ACEPTAR',
      }),
    { statusCode: 403, message: /Solo el cliente/ }
  );
});

test('RespondQuoteUseCase - valida cotizacionId y acción válida', async () => {
  const useCase = new RespondQuoteUseCase({
    cotizacionRepository: new InMemoryCotizacionRepository(),
    solicitudRepository: new InMemorySolicitudRepository(),
    historialSolicitudRepository: new InMemoryHistorialSolicitudRepository(),
  });
  const user = { userId: 'c-1', tenantId: 'trama-demo', role: 'CLIENT' };

  await assert.rejects(
    () => useCase.execute({ user, cotizacionId: '', accion: 'ACEPTAR' }),
    { statusCode: 400, message: 'El id de la cotización es obligatorio' }
  );

  await assert.rejects(
    () => useCase.execute({ user, cotizacionId: 'cot-1', accion: 'ELIMINAR' }),
    { statusCode: 400, message: /Acción no permitida/ }
  );
});

test('RespondQuoteUseCase - rechaza si cotización no existe, o solicitud ajena o de otro tenant', async () => {
  const cotizacionRepo = new InMemoryCotizacionRepository();
  const solicitudRepo = new InMemorySolicitudRepository();
  const historialRepo = new InMemoryHistorialSolicitudRepository();

  const useCase = new RespondQuoteUseCase({
    cotizacionRepository: cotizacionRepo,
    solicitudRepository: solicitudRepo,
    historialSolicitudRepository: historialRepo,
  });

  const user = { userId: 'demo-client-1', tenantId: 'trama-demo', role: 'CLIENT' };

  await assert.rejects(
    () => useCase.execute({ user, cotizacionId: 'cot-fantasma', accion: 'ACEPTAR' }),
    { statusCode: 404, message: 'Cotización no encontrada' }
  );

  const cotizacion = await cotizacionRepo.create(
    new Cotizacion({
      solicitudId: 'sol-demo-1',
      aliadoId: 'demo-ally-1',
      valorManoObra: 50000,
      valor: 50000,
      estado: 'PENDIENTE',
    })
  );

  const userOtroTenant = { userId: 'demo-client-1', tenantId: 'otro-tenant', role: 'CLIENT' };
  await assert.rejects(
    () => useCase.execute({ user: userOtroTenant, cotizacionId: cotizacion.id, accion: 'ACEPTAR' }),
    { statusCode: 404, message: 'Solicitud no encontrada' }
  );

  const userClienteAjeno = { userId: 'cliente-ajeno', tenantId: 'trama-demo', role: 'CLIENT' };
  await assert.rejects(
    () => useCase.execute({ user: userClienteAjeno, cotizacionId: cotizacion.id, accion: 'ACEPTAR' }),
    { statusCode: 403, message: /solicitud ajena/ }
  );
});

test('RespondQuoteUseCase - protección de doble acción (concurrencia / 409 CONFLICT)', async () => {
  const cotizacionRepo = new InMemoryCotizacionRepository();
  const solicitudRepo = new InMemorySolicitudRepository();
  const historialRepo = new InMemoryHistorialSolicitudRepository();

  const useCase = new RespondQuoteUseCase({
    cotizacionRepository: cotizacionRepo,
    solicitudRepository: solicitudRepo,
    historialSolicitudRepository: historialRepo,
  });

  const user = { userId: 'demo-client-1', tenantId: 'trama-demo', role: 'CLIENT' };

  const cotizacion = await cotizacionRepo.create(
    new Cotizacion({
      solicitudId: 'sol-demo-1',
      aliadoId: 'demo-ally-1',
      valorManoObra: 60000,
      valor: 60000,
      estado: 'ACEPTADA',
    })
  );

  await assert.rejects(
    () => useCase.execute({ user, cotizacionId: cotizacion.id, accion: 'ACEPTAR' }),
    { statusCode: 409, message: /ya fue procesada previamente con estado ACEPTADA/ }
  );
});

test('RespondQuoteUseCase - flujo exitoso ACEPTAR: transiciona a ACEPTADA y registra historial', async () => {
  const cotizacionRepo = new InMemoryCotizacionRepository();
  const solicitudRepo = new InMemorySolicitudRepository();
  const historialRepo = new InMemoryHistorialSolicitudRepository();

  const useCase = new RespondQuoteUseCase({
    cotizacionRepository: cotizacionRepo,
    solicitudRepository: solicitudRepo,
    historialSolicitudRepository: historialRepo,
  });

  const user = { userId: 'demo-client-1', tenantId: 'trama-demo', role: 'CLIENT' };

  const cot = await cotizacionRepo.create(
    new Cotizacion({
      solicitudId: 'sol-demo-1',
      aliadoId: 'demo-ally-1',
      valorManoObra: 80000,
      valor: 80000,
      estado: 'PENDIENTE',
      version: 1,
    })
  );

  const res = await useCase.execute({
    user,
    cotizacionId: cot.id,
    accion: 'ACEPTAR',
    comentario: 'Precio justo, por favor iniciar cuanto antes',
  });

  assert.equal(res.cotizacion.estado, 'ACEPTADA');
  assert.equal(res.solicitud.estado, 'ACEPTADA');

  const eventos = await historialRepo.findBySolicitudId('sol-demo-1');
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].estadoNuevo, 'ACEPTADA');
  assert.ok(eventos[0].observacion.includes('Precio justo'));
});

test('RespondQuoteUseCase - flujo RECHAZAR: exige motivo y transiciona a RECHAZADA', async () => {
  const cotizacionRepo = new InMemoryCotizacionRepository();
  const solicitudRepo = new InMemorySolicitudRepository();
  const historialRepo = new InMemoryHistorialSolicitudRepository();

  const useCase = new RespondQuoteUseCase({
    cotizacionRepository: cotizacionRepo,
    solicitudRepository: solicitudRepo,
    historialSolicitudRepository: historialRepo,
  });

  const user = { userId: 'demo-client-1', tenantId: 'trama-demo', role: 'CLIENT' };

  const cot = await cotizacionRepo.create(
    new Cotizacion({
      solicitudId: 'sol-demo-1',
      aliadoId: 'demo-ally-1',
      valorManoObra: 150000,
      valor: 150000,
      estado: 'PENDIENTE',
      version: 1,
    })
  );

  await assert.rejects(
    () => useCase.execute({ user, cotizacionId: cot.id, accion: 'RECHAZAR', motivo: '' }),
    { statusCode: 400, message: /motivo de rechazo es obligatorio/ }
  );

  const res = await useCase.execute({
    user,
    cotizacionId: cot.id,
    accion: 'RECHAZAR',
    motivo: 'El valor supera mi presupuesto y conseguí otro servicio',
  });

  assert.equal(res.cotizacion.estado, 'RECHAZADA');
  assert.equal(res.cotizacion.observacion, 'El valor supera mi presupuesto y conseguí otro servicio');
  assert.equal(res.solicitud.estado, 'RECHAZADA');

  const eventos = await historialRepo.findBySolicitudId('sol-demo-1');
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].estadoNuevo, 'RECHAZADA');
});

test('RespondQuoteUseCase - flujo AJUSTAR: exige comentario y cotización pasa a AJUSTE_SOLICITADO', async () => {
  const cotizacionRepo = new InMemoryCotizacionRepository();
  const solicitudRepo = new InMemorySolicitudRepository();
  const historialRepo = new InMemoryHistorialSolicitudRepository();

  const useCase = new RespondQuoteUseCase({
    cotizacionRepository: cotizacionRepo,
    solicitudRepository: solicitudRepo,
    historialSolicitudRepository: historialRepo,
  });

  const user = { userId: 'demo-client-1', tenantId: 'trama-demo', role: 'CLIENT' };

  const cot = await cotizacionRepo.create(
    new Cotizacion({
      solicitudId: 'sol-demo-1',
      aliadoId: 'demo-ally-1',
      valorManoObra: 90000,
      valorMateriales: 30000,
      valor: 120000,
      estado: 'PENDIENTE',
      version: 1,
    })
  );

  await assert.rejects(
    () => useCase.execute({ user, cotizacionId: cot.id, accion: 'AJUSTAR', comentario: '  ' }),
    { statusCode: 400, message: /Debes indicar el comentario/ }
  );

  const res = await useCase.execute({
    user,
    cotizacionId: cot.id,
    accion: 'AJUSTAR',
    comentario: 'Está muy caro, los materiales los puedo comprar yo mismo',
  });

  assert.equal(res.cotizacion.estado, 'AJUSTE_SOLICITADO');
  assert.equal(res.cotizacion.observacion, 'Está muy caro, los materiales los puedo comprar yo mismo');
  assert.equal(res.solicitud.estado, 'COTIZANDO');

  const eventos = await historialRepo.findBySolicitudId('sol-demo-1');
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].estadoNuevo, 'COTIZANDO');
  assert.ok(eventos[0].observacion.includes('Ajuste solicitado'));
});
