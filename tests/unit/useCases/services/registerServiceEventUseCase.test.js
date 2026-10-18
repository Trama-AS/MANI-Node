const test = require('node:test');
const assert = require('node:assert/strict');

const RegisterServiceEventUseCase = require('../../../../src/application/useCases/services/RegisterServiceEventUseCase');
const InMemorySolicitudRepository = require('../../../../src/infrastructure/repositories/InMemorySolicitudRepository');
const InMemoryHistorialSolicitudRepository = require('../../../../src/infrastructure/repositories/InMemoryHistorialSolicitudRepository');
const Solicitud = require('../../../../src/domain/entities/Solicitud');

test('RegisterServiceEventUseCase - validaciones del constructor', () => {
  assert.throws(() => new RegisterServiceEventUseCase({}), /solicitudRepository es requerido/);
  assert.throws(
    () => new RegisterServiceEventUseCase({ solicitudRepository: {} }),
    /historialSolicitudRepository es requerido/
  );
});

test('RegisterServiceEventUseCase - rechaza si falta sesión o el rol no es ALLY', async () => {
  const useCase = new RegisterServiceEventUseCase({
    solicitudRepository: new InMemorySolicitudRepository(),
    historialSolicitudRepository: new InMemoryHistorialSolicitudRepository(),
  });

  await assert.rejects(
    () => useCase.execute({ user: null, solicitudId: 'sol-1', observacion: 'Imprevisto' }),
    { statusCode: 403, message: 'Sesión requerida' }
  );

  await assert.rejects(
    () =>
      useCase.execute({
        user: { userId: 'u-1', tenantId: 'trama-demo', role: 'CLIENT' },
        solicitudId: 'sol-1',
        observacion: 'Imprevisto',
      }),
    { statusCode: 403, message: /Solo el aliado/ }
  );
});

test('RegisterServiceEventUseCase - valida solicitudId, existencia y tenant', async () => {
  const useCase = new RegisterServiceEventUseCase({
    solicitudRepository: new InMemorySolicitudRepository(),
    historialSolicitudRepository: new InMemoryHistorialSolicitudRepository(),
  });
  const user = { userId: 'demo-ally-1', tenantId: 'trama-demo', role: 'ALLY' };

  await assert.rejects(
    () => useCase.execute({ user, solicitudId: '', observacion: 'Tubería rota' }),
    { statusCode: 400, message: 'El id de la solicitud es obligatorio' }
  );

  await assert.rejects(
    () => useCase.execute({ user, solicitudId: 'sol-no-existe', observacion: 'Tubería rota' }),
    { statusCode: 404, message: 'Solicitud no encontrada' }
  );

  const userOtroTenant = { userId: 'demo-ally-1', tenantId: 'otro-tenant', role: 'ALLY' };
  await assert.rejects(
    () => useCase.execute({ user: userOtroTenant, solicitudId: 'sol-demo-1', observacion: 'Tubería rota' }),
    { statusCode: 404, message: 'Solicitud no encontrada' }
  );
});

test('RegisterServiceEventUseCase - rechaza si solicitud pertenece a otro aliado o está finalizada', async () => {
  const solicitudRepo = new InMemorySolicitudRepository();
  const useCase = new RegisterServiceEventUseCase({
    solicitudRepository: solicitudRepo,
    historialSolicitudRepository: new InMemoryHistorialSolicitudRepository(),
  });

  const userAjeno = { userId: 'aliado-ajeno', tenantId: 'trama-demo', role: 'ALLY' };
  await assert.rejects(
    () => useCase.execute({ user: userAjeno, solicitudId: 'sol-demo-1', observacion: 'Comentario' }),
    { statusCode: 403, message: /asignada a otro aliado/ }
  );

  const solFinalizada = await solicitudRepo.create(
    new Solicitud({
      tenantId: 'trama-demo',
      clienteId: 'c-1',
      aliadoId: 'demo-ally-1',
      categoriaId: 'cat-1',
      zonaId: 'z-1',
      descripcion: 'Finalizada',
      estado: 'FINALIZADA',
    })
  );

  const userCorrecto = { userId: 'demo-ally-1', tenantId: 'trama-demo', role: 'ALLY' };
  await assert.rejects(
    () => useCase.execute({ user: userCorrecto, solicitudId: solFinalizada.id, observacion: 'Comentario' }),
    { statusCode: 409, message: /en estado FINALIZADA/ }
  );
});

test('RegisterServiceEventUseCase - valida longitud de comentario', async () => {
  const useCase = new RegisterServiceEventUseCase({
    solicitudRepository: new InMemorySolicitudRepository(),
    historialSolicitudRepository: new InMemoryHistorialSolicitudRepository(),
  });
  const user = { userId: 'demo-ally-1', tenantId: 'trama-demo', role: 'ALLY' };

  await assert.rejects(
    () => useCase.execute({ user, solicitudId: 'sol-demo-1', observacion: '  ' }),
    { statusCode: 400, message: /mínimo 3 caracteres/ }
  );
});

test('RegisterServiceEventUseCase - registra evento exitosamente con foto y trazabilidad', async () => {
  const solicitudRepo = new InMemorySolicitudRepository();
  const historialRepo = new InMemoryHistorialSolicitudRepository();
  const useCase = new RegisterServiceEventUseCase({
    solicitudRepository: solicitudRepo,
    historialSolicitudRepository: historialRepo,
  });

  const user = { userId: 'demo-ally-1', tenantId: 'trama-demo', role: 'ALLY' };
  const res = await useCase.execute({
    user,
    solicitudId: 'sol-demo-1',
    observacion: 'Se encontró daño en la válvula principal que requirió llave de paso extra',
    fotoUrl: 'https://storage.mani.local/evidencias/valvula-danada.jpg',
  });

  assert.ok(res.evento.id);
  assert.equal(res.evento.solicitudId, 'sol-demo-1');
  assert.equal(res.evento.usuarioId, 'demo-ally-1');
  assert.ok(res.evento.observacion.includes('válvula principal'));
  assert.equal(res.evento.fotoUrl, 'https://storage.mani.local/evidencias/valvula-danada.jpg');

  const eventos = await historialRepo.findBySolicitudId('sol-demo-1');
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].fotoUrl, 'https://storage.mani.local/evidencias/valvula-danada.jpg');
});
