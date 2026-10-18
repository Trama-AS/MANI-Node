const test = require('node:test');
const assert = require('node:assert/strict');

const CreateQuoteUseCase = require('../../../../src/application/useCases/quotes/CreateQuoteUseCase');
const InMemoryCotizacionRepository = require('../../../../src/infrastructure/repositories/InMemoryCotizacionRepository');
const InMemorySolicitudRepository = require('../../../../src/infrastructure/repositories/InMemorySolicitudRepository');
const InMemoryHistorialSolicitudRepository = require('../../../../src/infrastructure/repositories/InMemoryHistorialSolicitudRepository');
const Solicitud = require('../../../../src/domain/entities/Solicitud');

test('CreateQuoteUseCase - validaciones del constructor', () => {
  assert.throws(() => new CreateQuoteUseCase({}), /cotizacionRepository es requerido/);
  assert.throws(
    () => new CreateQuoteUseCase({ cotizacionRepository: {} }),
    /solicitudRepository es requerido/
  );
  assert.throws(
    () => new CreateQuoteUseCase({ cotizacionRepository: {}, solicitudRepository: {} }),
    /historialSolicitudRepository es requerido/
  );
});

test('CreateQuoteUseCase - rechaza si falta sesión o el rol no es ALLY', async () => {
  const useCase = new CreateQuoteUseCase({
    cotizacionRepository: new InMemoryCotizacionRepository(),
    solicitudRepository: new InMemorySolicitudRepository(),
    historialSolicitudRepository: new InMemoryHistorialSolicitudRepository(),
  });

  await assert.rejects(
    () => useCase.execute({ user: null, solicitudId: 'sol-1', valorManoObra: 50000 }),
    { statusCode: 403, message: 'Sesión requerida para emitir cotización' }
  );

  await assert.rejects(
    () =>
      useCase.execute({
        user: { userId: 'u-1', tenantId: 'trama-demo', role: 'CLIENT' },
        solicitudId: 'sol-1',
        valorManoObra: 50000,
      }),
    { statusCode: 403, message: 'Solo un aliado puede emitir cotizaciones' }
  );
});

test('CreateQuoteUseCase - valida solicitudId y valores numéricos no negativos', async () => {
  const useCase = new CreateQuoteUseCase({
    cotizacionRepository: new InMemoryCotizacionRepository(),
    solicitudRepository: new InMemorySolicitudRepository(),
    historialSolicitudRepository: new InMemoryHistorialSolicitudRepository(),
  });
  const user = { userId: 'demo-ally-1', tenantId: 'trama-demo', role: 'ALLY' };

  await assert.rejects(
    () => useCase.execute({ user, solicitudId: '', valorManoObra: 50000 }),
    { statusCode: 400, message: 'El id de la solicitud es obligatorio' }
  );

  await assert.rejects(
    () => useCase.execute({ user, solicitudId: 'sol-1', valorManoObra: 'abc' }),
    { statusCode: 400, message: 'El valor de mano de obra es obligatorio y debe ser numérico' }
  );

  await assert.rejects(
    () => useCase.execute({ user, solicitudId: 'sol-1', valorManoObra: -100 }),
    { statusCode: 400, message: 'El valor de mano de obra no puede ser negativo' }
  );

  await assert.rejects(
    () => useCase.execute({ user, solicitudId: 'sol-1', valorManoObra: 50000, valorMateriales: -20 }),
    { statusCode: 400, message: 'El valor de materiales no puede ser negativo' }
  );

  await assert.rejects(
    () =>
      useCase.execute({
        user,
        solicitudId: 'sol-1',
        valorManoObra: 50000,
        valorMateriales: 20000,
        valor: 99999,
      }),
    { statusCode: 400, message: /debe coincidir exactamente con la suma/ }
  );
});

test('CreateQuoteUseCase - rechaza solicitud inexistente o de otro tenant', async () => {
  const useCase = new CreateQuoteUseCase({
    cotizacionRepository: new InMemoryCotizacionRepository(),
    solicitudRepository: new InMemorySolicitudRepository(),
    historialSolicitudRepository: new InMemoryHistorialSolicitudRepository(),
  });
  const user = { userId: 'demo-ally-1', tenantId: 'trama-demo', role: 'ALLY' };

  await assert.rejects(
    () => useCase.execute({ user, solicitudId: 'sol-no-existe', valorManoObra: 50000 }),
    { statusCode: 404, message: 'Solicitud no encontrada' }
  );

  const userOtroTenant = { userId: 'demo-ally-1', tenantId: 'otro-tenant', role: 'ALLY' };
  await assert.rejects(
    () => useCase.execute({ user: userOtroTenant, solicitudId: 'sol-demo-1', valorManoObra: 50000 }),
    { statusCode: 404, message: 'Solicitud no encontrada' }
  );
});

test('CreateQuoteUseCase - rechaza si la solicitud está asignada a otro aliado o en estado inválido', async () => {
  const solicitudRepo = new InMemorySolicitudRepository();
  const useCase = new CreateQuoteUseCase({
    cotizacionRepository: new InMemoryCotizacionRepository(),
    solicitudRepository: solicitudRepo,
    historialSolicitudRepository: new InMemoryHistorialSolicitudRepository(),
  });

  const userAjeno = { userId: 'aliado-ajeno', tenantId: 'trama-demo', role: 'ALLY' };
  await assert.rejects(
    () => useCase.execute({ user: userAjeno, solicitudId: 'sol-demo-1', valorManoObra: 50000 }),
    { statusCode: 403, message: /asignada a otro aliado/ }
  );

  const solFinalizada = await solicitudRepo.create(
    new Solicitud({
      tenantId: 'trama-demo',
      clienteId: 'c-1',
      aliadoId: 'demo-ally-1',
      categoriaId: 'cat-1',
      zonaId: 'z-1',
      descripcion: 'Trabajo terminado',
      estado: 'FINALIZADA',
    })
  );

  const userCorrecto = { userId: 'demo-ally-1', tenantId: 'trama-demo', role: 'ALLY' };
  await assert.rejects(
    () => useCase.execute({ user: userCorrecto, solicitudId: solFinalizada.id, valorManoObra: 50000 }),
    { statusCode: 409, message: /en estado FINALIZADA/ }
  );
});

test('CreateQuoteUseCase - emite cotización sin materiales (default 0), calcula total y version 1', async () => {
  const cotizacionRepo = new InMemoryCotizacionRepository();
  const solicitudRepo = new InMemorySolicitudRepository();
  const historialRepo = new InMemoryHistorialSolicitudRepository();

  const useCase = new CreateQuoteUseCase({
    cotizacionRepository: cotizacionRepo,
    solicitudRepository: solicitudRepo,
    historialSolicitudRepository: historialRepo,
  });

  const user = { userId: 'demo-ally-1', tenantId: 'trama-demo', role: 'ALLY' };
  const res = await useCase.execute({
    user,
    solicitudId: 'sol-demo-1',
    valorManoObra: 85000.5,
  });

  assert.ok(res.cotizacion.id);
  assert.equal(res.cotizacion.valorManoObra, 85000.5);
  assert.equal(res.cotizacion.valorMateriales, 0);
  assert.equal(res.cotizacion.valor, 85000.5);
  assert.equal(res.cotizacion.moneda, 'COP');
  assert.equal(res.cotizacion.estado, 'PENDIENTE');
  assert.equal(res.cotizacion.version, 1);
  assert.equal(res.fueraDeRango, false);
  assert.equal(res.alerta, null);

  const solActualizada = await solicitudRepo.findById('sol-demo-1');
  assert.equal(solActualizada.estado, 'COTIZANDO');

  const eventos = await historialRepo.findBySolicitudId('sol-demo-1');
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].estadoNuevo, 'COTIZANDO');
  assert.ok(eventos[0].observacion.includes('Cotización v1'));
});

test('CreateQuoteUseCase - incrementa versión y alerta cotización fuera de rango sin bloquear (RF-16)', async () => {
  const cotizacionRepo = new InMemoryCotizacionRepository();
  const solicitudRepo = new InMemorySolicitudRepository();
  const historialRepo = new InMemoryHistorialSolicitudRepository();

  const useCase = new CreateQuoteUseCase({
    cotizacionRepository: cotizacionRepo,
    solicitudRepository: solicitudRepo,
    historialSolicitudRepository: historialRepo,
  });

  const user = { userId: 'demo-ally-1', tenantId: 'trama-demo', role: 'ALLY' };

  // Primera cotización
  await useCase.execute({
    user,
    solicitudId: 'sol-demo-1',
    valorManoObra: 100000,
    valorMateriales: 50000,
    valor: 150000,
  });

  // Segunda cotización (ajustada o nueva versión) con valor alto fuera de rango
  const res2 = await useCase.execute({
    user,
    solicitudId: 'sol-demo-1',
    valorManoObra: 1200000,
    valorMateriales: 300000,
    observacion: 'Materiales especiales importados',
  });

  assert.equal(res2.cotizacion.version, 2);
  assert.equal(res2.cotizacion.valorManoObra, 1200000);
  assert.equal(res2.cotizacion.valorMateriales, 300000);
  assert.equal(res2.cotizacion.valor, 1500000);
  assert.equal(res2.fueraDeRango, true);
  assert.ok(res2.alerta.includes('excede el tarifario'));
  assert.equal(res2.cotizacion.estado, 'PENDIENTE');

  const historial = await historialRepo.findBySolicitudId('sol-demo-1');
  assert.equal(historial.length, 2);
  assert.ok(historial[1].observacion.includes('Cotización v2'));
});
