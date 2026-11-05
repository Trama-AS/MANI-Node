const test = require('node:test');
const assert = require('node:assert/strict');
const AssignServiceRequestUseCase = require('../../../../src/application/useCases/requests/AssignServiceRequestUseCase');
const ListAllyOffersUseCase = require('../../../../src/application/useCases/dispatch/ListAllyOffersUseCase');
const { ConflictError } = require('../../../../src/domain/errors/DomainError');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';
const aliado = { tenantId: TENANT, userId: USER, role: 'ALLY' };

function setup(asignar = async () => ({ solicitud: { id: SOLICITUD, estado: 'ASIGNADA' }, asignada: true })) {
  const llamadas = [];
  const logs = [];
  const useCase = new AssignServiceRequestUseCase({
    solicitudAsignacionRepository: { asignar: async (ctx, id) => { llamadas.push({ ctx, id }); return asignar(ctx, id); } },
    auditLogger: (entry) => logs.push(entry),
  });
  return { useCase, llamadas, logs };
}

test('asignación: pasa al repositorio la sesión del aliado y registra el resultado con el correlationId', async () => {
  const { useCase, llamadas, logs } = setup();

  const r = await useCase.execute({ user: aliado, solicitudId: SOLICITUD, correlationId: 'corr-1', idempotencyKey: 'k-1' });

  assert.equal(r.asignada, true);
  assert.deepEqual(llamadas[0], { ctx: { tenantId: TENANT, userId: USER, role: 'ALLY' }, id: SOLICITUD });
  assert.deepEqual(logs[0], {
    evento: 'SOLICITUD_ASIGNACION', correlationId: 'corr-1', idempotencyKey: 'k-1', tenantId: TENANT,
    solicitudId: SOLICITUD, usuarioId: USER, resultado: 'ASIGNADA',
  });
});

test('asignación: un reintento se registra como REINTENTO y un conflicto como RECHAZADA con su código', async () => {
  const reintento = setup(async () => ({ solicitud: { id: SOLICITUD }, asignada: false }));
  await reintento.useCase.execute({ user: aliado, solicitudId: SOLICITUD });
  assert.equal(reintento.logs[0].resultado, 'REINTENTO');

  const conflicto = setup(async () => { throw new ConflictError('MANI-SOL-409: no disponible', 'MANI-SOL-409'); });
  await assert.rejects(() => conflicto.useCase.execute({ user: aliado, solicitudId: SOLICITUD }), (err) => err.code === 'MANI-SOL-409');
  assert.equal(conflicto.logs[0].resultado, 'RECHAZADA');
  assert.equal(conflicto.logs[0].code, 'MANI-SOL-409');
});

test('asignación: sin sesión 401, con un rol que no es aliado 403 y con un id inválido 400, sin llegar al repositorio', async () => {
  const { useCase, llamadas } = setup();

  await assert.rejects(() => useCase.execute({ user: null, solicitudId: SOLICITUD }), (e) => e.statusCode === 401 && e.code === 'MANI-SOL-401');
  await assert.rejects(
    () => useCase.execute({ user: { ...aliado, userId: 'no-uuid' }, solicitudId: SOLICITUD }),
    (e) => e.code === 'MANI-SOL-401'
  );
  for (const role of ['CLIENT', 'ADMIN']) {
    await assert.rejects(() => useCase.execute({ user: { ...aliado, role }, solicitudId: SOLICITUD }), (e) => e.statusCode === 403 && e.code === 'MANI-SOL-403');
  }
  await assert.rejects(() => useCase.execute({ user: aliado, solicitudId: 'x' }), (e) => e.statusCode === 400 && e.code === 'MANI-SOL-400');
  assert.equal(llamadas.length, 0);
});

test('asignación y bandeja: exigen el repositorio', () => {
  assert.throws(() => new AssignServiceRequestUseCase({}), /solicitudAsignacionRepository/);
  assert.throws(() => new ListAllyOffersUseCase({}), /solicitudAsignacionRepository/);
});

test('bandeja del aliado: solo un aliado con usuario UUID; pasa el contexto de la sesión', async () => {
  const llamadas = [];
  const useCase = new ListAllyOffersUseCase({
    solicitudAsignacionRepository: { ofertasDelAliado: async (ctx) => { llamadas.push(ctx); return [{ id: SOLICITUD }]; } },
  });

  assert.deepEqual(await useCase.execute({ session: aliado }), [{ id: SOLICITUD }]);
  assert.deepEqual(llamadas[0], { tenantId: TENANT, userId: USER, role: 'ALLY' });

  for (const session of [{ ...aliado, role: 'CLIENT' }, { ...aliado, userId: 'x' }, { ...aliado, tenantId: null }]) {
    await assert.rejects(() => useCase.execute({ session }), (e) => e.statusCode === 403 && e.code === 'MANI-DSP-403');
  }
  assert.equal(llamadas.length, 1);
});
