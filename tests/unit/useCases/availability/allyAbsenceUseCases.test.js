const test = require('node:test');
const assert = require('node:assert/strict');
const ListAllyAbsencesUseCase = require('../../../../src/application/useCases/availability/ListAllyAbsencesUseCase');
const CreateAllyAbsenceUseCase = require('../../../../src/application/useCases/availability/CreateAllyAbsenceUseCase');
const UpdateAllyAbsenceUseCase = require('../../../../src/application/useCases/availability/UpdateAllyAbsenceUseCase');
const DeleteAllyAbsenceUseCase = require('../../../../src/application/useCases/availability/DeleteAllyAbsenceUseCase');
const InMemoryAliadoAusenciaRepository = require('../../../../src/infrastructure/repositories/InMemoryAliadoAusenciaRepository');

const NOW = new Date('2026-10-17T15:00:00Z');
const clock = () => NOW;
const ALLY = { userId: 'u1', tenantId: 't1', role: 'ALLY' };
const OTHER_TENANT_ALLY = { userId: 'u2', tenantId: 't2', role: 'ALLY' };

function makeDeps() {
  const aliados = {
    u1: { id: 'a1', usuarioId: 'u1', tenantId: 't1' },
    u2: { id: 'a2', usuarioId: 'u2', tenantId: 't2' },
  };
  const aliadoRepository = {
    findByUsuarioId: async (tenantId, usuarioId) => {
      const aliado = aliados[usuarioId];
      return aliado && aliado.tenantId === tenantId ? aliado : null;
    },
  };
  const aliadoAusenciaRepository = new InMemoryAliadoAusenciaRepository();
  const deps = { aliadoRepository, aliadoAusenciaRepository, clock };
  return {
    list: new ListAllyAbsencesUseCase(deps),
    create: new CreateAllyAbsenceUseCase(deps),
    update: new UpdateAllyAbsenceUseCase(deps),
    remove: new DeleteAllyAbsenceUseCase(deps),
  };
}

const vacation = {
  startsAt: '2026-10-20T08:00:00-05:00',
  endsAt: '2026-10-25T18:00:00-05:00',
  reason: 'VACACIONES',
};

async function assertDomainError(promise, code, statusCode) {
  await assert.rejects(promise, (err) => {
    assert.equal(err.code, code);
    assert.equal(err.statusCode, statusCode);
    return true;
  });
}

test('los casos de uso exigen sus repositorios', () => {
  for (const UseCase of [ListAllyAbsencesUseCase, CreateAllyAbsenceUseCase, UpdateAllyAbsenceUseCase, DeleteAllyAbsenceUseCase]) {
    assert.throws(() => new UseCase({}), /aliadoRepository es requerido/);
    assert.throws(() => new UseCase({ aliadoRepository: {} }), /aliadoAusenciaRepository es requerido/);
  }
});

test('sin sesión responde 401 y con rol distinto de ALLY responde 403', async () => {
  const { list, create } = makeDeps();

  await assertDomainError(list.execute({}), 'MANI-AUS-401', 401);
  await assertDomainError(create.execute({ ...ALLY, role: 'CLIENT', ...vacation }), 'MANI-AUS-403', 403);
});

test('un usuario ALLY sin aliado en ese tenant responde 403', async () => {
  const { create } = makeDeps();

  await assertDomainError(create.execute({ ...ALLY, tenantId: 't2', ...vacation }), 'MANI-AUS-403', 403);
});

test('crear una ausencia la deja listada y marca availableNow según el instante actual', async () => {
  const { list, create } = makeDeps();

  const created = await create.execute({ ...ALLY, ...vacation });
  assert.ok(created.id);

  const futureOnly = await list.execute(ALLY);
  assert.equal(futureOnly.absences.length, 1);
  assert.equal(futureOnly.availableNow, true);

  await create.execute({ ...ALLY, startsAt: '2026-10-17T07:00:00-05:00', endsAt: '2026-10-18T07:00:00-05:00', reason: 'ENFERMEDAD' });
  const sickToday = await list.execute(ALLY);
  assert.equal(sickToday.availableNow, false);
  assert.equal(sickToday.absences[0].reason, 'ENFERMEDAD');
});

test('crear una ausencia que se cruza con otra responde 409 (MANI-AUS-409)', async () => {
  const { create } = makeDeps();
  await create.execute({ ...ALLY, ...vacation });

  await assertDomainError(
    create.execute({ ...ALLY, startsAt: '2026-10-25T12:00:00-05:00', endsAt: '2026-10-27T12:00:00-05:00', reason: 'OTRO' }),
    'MANI-AUS-409',
    409
  );
  // Contigua (empieza justo cuando termina la anterior): se permite.
  await create.execute({ ...ALLY, startsAt: vacation.endsAt, endsAt: '2026-10-27T12:00:00-05:00', reason: 'OTRO' });
});

test('el solapamiento se evalúa por aliado: otro tenant puede tener el mismo intervalo', async () => {
  const { create, list } = makeDeps();
  await create.execute({ ...ALLY, ...vacation });
  await create.execute({ ...OTHER_TENANT_ALLY, ...vacation });

  assert.equal((await list.execute(ALLY)).absences.length, 1);
  assert.equal((await list.execute(OTHER_TENANT_ALLY)).absences.length, 1);
});

test('crear una ausencia que ya terminó responde 422 (MANI-AUS-422H)', async () => {
  const { create } = makeDeps();

  await assertDomainError(
    create.execute({ ...ALLY, startsAt: '2026-10-10T08:00:00-05:00', endsAt: '2026-10-12T08:00:00-05:00', reason: 'VACACIONES' }),
    'MANI-AUS-422H',
    422
  );
});

test('editar cambia solo los campos enviados y no choca consigo misma', async () => {
  const { create, update } = makeDeps();
  const created = await create.execute({ ...ALLY, ...vacation, note: 'Viaje' });

  const updated = await update.execute({ ...ALLY, absenceId: created.id, endsAt: '2026-10-26T18:00:00-05:00' });

  assert.equal(updated.endsAt.toISOString(), '2026-10-26T23:00:00.000Z');
  assert.equal(updated.reason, 'VACACIONES');
  assert.equal(updated.note, 'Viaje');

  const cleared = await update.execute({ ...ALLY, absenceId: created.id, note: null });
  assert.equal(cleared.note, null);
});

test('editar hacia un cruce con otra ausencia responde 409 y con horario inválido responde 422', async () => {
  const { create, update } = makeDeps();
  const first = await create.execute({ ...ALLY, ...vacation });
  await create.execute({ ...ALLY, startsAt: '2026-11-01T08:00:00-05:00', endsAt: '2026-11-03T08:00:00-05:00', reason: 'OTRO' });

  await assertDomainError(
    update.execute({ ...ALLY, absenceId: first.id, endsAt: '2026-11-02T08:00:00-05:00' }),
    'MANI-AUS-409',
    409
  );
  await assertDomainError(
    update.execute({ ...ALLY, absenceId: first.id, endsAt: '2026-10-19T08:00:00-05:00' }),
    'MANI-AUS-422H',
    422
  );
});

test('editar o borrar la ausencia de otro aliado responde 404 (MANI-AUS-404)', async () => {
  const { create, update, remove } = makeDeps();
  const foreign = await create.execute({ ...OTHER_TENANT_ALLY, ...vacation });

  await assertDomainError(update.execute({ ...ALLY, absenceId: foreign.id, reason: 'OTRO' }), 'MANI-AUS-404', 404);
  await assertDomainError(remove.execute({ ...ALLY, absenceId: foreign.id }), 'MANI-AUS-404', 404);
  await assertDomainError(remove.execute({ ...ALLY }), 'MANI-AUS-404', 404);
});

test('borrar la ausencia devuelve al aliado a disponible', async () => {
  const { create, list, remove } = makeDeps();
  const sick = await create.execute({ ...ALLY, startsAt: '2026-10-17T07:00:00-05:00', endsAt: '2026-10-18T07:00:00-05:00', reason: 'ENFERMEDAD' });
  assert.equal((await list.execute(ALLY)).availableNow, false);

  await remove.execute({ ...ALLY, absenceId: sick.id });

  const after = await list.execute(ALLY);
  assert.equal(after.availableNow, true);
  assert.equal(after.absences.length, 0);
});
