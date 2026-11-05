const test = require('node:test');
const assert = require('node:assert/strict');
const CancelServiceRequestUseCase = require('../../../../src/application/useCases/requests/CancelServiceRequestUseCase');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SOL = '44444444-4444-4444-8444-444444444444';
const cliente = { tenantId: TENANT, userId: USER, role: 'CLIENT' };

function conRepo(resultado = { solicitud: { id: SOL, estado: 'CANCELADA' }, cancelada: true }) {
  const llamadas = [];
  const repo = {
    cancelar: async (ctx, datos) => {
      llamadas.push({ ctx, datos });
      return resultado;
    },
  };
  return { uc: new CancelServiceRequestUseCase({ serviceRequestRepository: repo }), llamadas };
}

test('SCRUM-877: cancela con el tenant y el usuario del token y el motivo recortado', async () => {
  const { uc, llamadas } = conRepo();

  const r = await uc.execute({ user: { ...cliente, extra: 'ignorado' }, solicitudId: SOL, body: { motivo: '  Ya lo resolví  ', tenantId: 'otro' } });

  assert.equal(r.cancelada, true);
  assert.deepEqual(llamadas[0].ctx, { tenantId: TENANT, userId: USER, role: 'CLIENT' });
  assert.deepEqual(llamadas[0].datos, { solicitudId: SOL, motivo: 'Ya lo resolví' });
});

test('SCRUM-877: sin motivo, o con motivo en blanco, pasa null', async () => {
  for (const body of [undefined, {}, { motivo: null }, { motivo: '   ' }]) {
    const { uc, llamadas } = conRepo();
    await uc.execute({ user: cliente, solicitudId: SOL, body });
    assert.equal(llamadas[0].datos.motivo, null);
  }
});

test('SCRUM-877: sin sesión responde 401 y un rol distinto de cliente 403, sin tocar el repositorio', async () => {
  for (const [user, status, code] of [
    [null, 401, 'MANI-SOL-401'],
    [{ tenantId: TENANT }, 401, 'MANI-SOL-401'],
    [{ ...cliente, userId: 'no-uuid' }, 401, 'MANI-SOL-401'],
    [{ ...cliente, role: 'ALLY' }, 403, 'MANI-SOL-403C'],
    [{ ...cliente, role: 'ADMIN_TENANT' }, 403, 'MANI-SOL-403C'],
  ]) {
    const { uc, llamadas } = conRepo();
    await assert.rejects(() => uc.execute({ user, solicitudId: SOL }), (e) => e.statusCode === status && e.code === code);
    assert.equal(llamadas.length, 0);
  }
});

test('SCRUM-877: un id que no es UUID responde 400 y un motivo de más de 200 caracteres 422', async () => {
  const { uc, llamadas } = conRepo();

  await assert.rejects(() => uc.execute({ user: cliente, solicitudId: 'no-es-uuid' }), (e) => e.statusCode === 400 && e.code === 'MANI-SOL-400');
  await assert.rejects(
    () => uc.execute({ user: cliente, solicitudId: SOL, body: { motivo: 'x'.repeat(201) } }),
    (e) => e.statusCode === 422 && e.code === 'MANI-SOL-422M'
  );
  assert.equal(llamadas.length, 0);
});

test('SCRUM-877: exige el repositorio', () => {
  assert.throws(() => new CancelServiceRequestUseCase({}), /serviceRequestRepository/);
});
