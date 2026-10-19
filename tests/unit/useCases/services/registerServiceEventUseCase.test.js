const test = require('node:test');
const assert = require('node:assert/strict');
const RegisterServiceEventUseCase = require('../../../../src/application/useCases/services/RegisterServiceEventUseCase');
const InMemorySolicitudRepository = require('../../../../src/infrastructure/repositories/InMemorySolicitudRepository');
const InMemoryEventoServicioRepository = require('../../../../src/infrastructure/repositories/InMemoryEventoServicioRepository');

const TENANT = 'tenant-a';
const ally = { userId: 'usuario-aliado-1', tenantId: TENANT, role: 'ALLY' };

function setup({ aliado = { id: 'aliado-1', usuarioId: 'usuario-aliado-1', tenantId: TENANT }, solicitud = {} } = {}) {
  const solicitudRepository = new InMemorySolicitudRepository();
  const eventoServicioRepository = new InMemoryEventoServicioRepository();
  solicitudRepository.seed({ id: 'sol-1', tenantId: TENANT, clienteId: 'cl', categoriaId: 'c', zonaId: 'z', aliadoId: 'aliado-1', estado: 'EN_EJECUCION', ...solicitud });
  const subidas = [];
  const fileStorageService = { upload: async ({ path }) => { subidas.push(path); return { path: `bucket/${path}` }; } };
  const aliadoRepository = { findByUsuarioId: async (t, u) => (aliado && aliado.tenantId === t && aliado.usuarioId === u ? aliado : null) };
  return {
    useCase: new RegisterServiceEventUseCase({ solicitudRepository, eventoServicioRepository, aliadoRepository, fileStorageService }),
    eventoServicioRepository,
    subidas,
  };
}

const foto = { originalname: 'té mp.png', mimetype: 'image/png', buffer: Buffer.from('x') };

test('registra el evento en evento_servicio con la ruta de la evidencia bajo {tenant}/{usuario}/eventos/', async () => {
  const { useCase, eventoServicioRepository, subidas } = setup();

  const { evento } = await useCase.execute({ user: ally, solicitudId: 'sol-1', observacion: ' Termostato quemado ', file: foto });

  assert.equal(evento.tipoEvento, 'EVENTO_EJECUCION');
  assert.equal(evento.descripcion, 'Termostato quemado');
  assert.match(subidas[0], /^tenant-a\/usuario-aliado-1\/eventos\/sol-1-\d+-t/);
  assert.equal(evento.evidenciaRuta, `bucket/${subidas[0]}`);
  assert.equal((await eventoServicioRepository.findBySolicitudId({ tenantId: TENANT }, 'sol-1')).length, 1);
});

test('sin foto el evento se guarda sin evidencia', async () => {
  const { useCase, subidas } = setup();

  const { evento } = await useCase.execute({ user: ally, solicitudId: 'sol-1', observacion: 'Todo en orden' });

  assert.equal(evento.evidenciaRuta, null);
  assert.equal(subidas.length, 0);
});

for (const [name, input] of [
  ['una URL de foto en el cuerpo', { observacion: 'Imprevisto', fotoUrl: 'https://evil.example/x.png' }],
  ['un archivo que no es imagen', { observacion: 'Imprevisto', file: { ...foto, mimetype: 'application/pdf' } }],
  ['observación corta', { observacion: 'ok' }],
  ['observación de más de 2000 caracteres', { observacion: 'x'.repeat(2001) }],
  ['sin solicitud', { observacion: 'Imprevisto', solicitudId: '' }],
]) {
  test(`validación: ${name} responde 400 y no escribe`, async () => {
    const { useCase, eventoServicioRepository } = setup();

    await assert.rejects(() => useCase.execute({ user: ally, solicitudId: 'sol-1', ...input }), (e) => e.statusCode === 400);
    assert.equal((await eventoServicioRepository.findBySolicitudId({ tenantId: TENANT }, 'sol-1')).length, 0);
  });
}

test('compara solicitud.aliado_id con aliado.id: otro aliado 403; sin perfil 403; otro tenant 404', async () => {
  await assert.rejects(() => setup({ solicitud: { aliadoId: 'aliado-2' } }).useCase.execute({ user: ally, solicitudId: 'sol-1', observacion: 'Imprevisto' }), (e) => e.statusCode === 403);
  await assert.rejects(() => setup({ aliado: null }).useCase.execute({ user: ally, solicitudId: 'sol-1', observacion: 'Imprevisto' }), (e) => e.statusCode === 403);
  await assert.rejects(() => setup({ solicitud: { tenantId: 'tenant-b' } }).useCase.execute({ user: ally, solicitudId: 'sol-1', observacion: 'Imprevisto' }), (e) => e.statusCode === 404);
});

for (const estado of ['FINALIZADA', 'CANCELADA', 'RECHAZADA']) {
  test(`un servicio ${estado} no admite eventos (409)`, async () => {
    await assert.rejects(() => setup({ solicitud: { estado } }).useCase.execute({ user: ally, solicitudId: 'sol-1', observacion: 'Imprevisto' }), (e) => e.statusCode === 409);
  });
}

test('un cliente o una sesión sin tenant no registran eventos (403)', async () => {
  const { useCase } = setup();

  await assert.rejects(() => useCase.execute({ user: { ...ally, role: 'CLIENT' }, solicitudId: 'sol-1', observacion: 'Imprevisto' }), (e) => e.statusCode === 403);
  await assert.rejects(() => useCase.execute({ user: { userId: 'x', role: 'ALLY' }, solicitudId: 'sol-1', observacion: 'Imprevisto' }), (e) => e.statusCode === 403);
});

test('exige sus dependencias', () => {
  assert.throws(() => new RegisterServiceEventUseCase({}), /solicitudRepository/);
  assert.throws(() => new RegisterServiceEventUseCase({ solicitudRepository: {} }), /eventoServicioRepository/);
  assert.throws(() => new RegisterServiceEventUseCase({ solicitudRepository: {}, eventoServicioRepository: {} }), /aliadoRepository/);
  assert.throws(() => new RegisterServiceEventUseCase({ solicitudRepository: {}, eventoServicioRepository: {}, aliadoRepository: {} }), /fileStorageService/);
});
