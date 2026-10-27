const test = require('node:test');
const assert = require('node:assert/strict');
const ConsultOwnServiceRequestsUseCase = require('../../../../src/application/useCases/requests/ConsultOwnServiceRequestsUseCase');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SOL = '44444444-4444-4444-8444-444444444444';
const cliente = { tenantId: TENANT, userId: USER, role: 'CLIENT' };

function conRepo(respuestas = {}) {
  const llamadas = [];
  const repo = {
    listarDelCliente: async (ctx) => {
      llamadas.push(['listar', ctx]);
      return respuestas.lista ?? [];
    },
    obtenerDelCliente: async (ctx, id) => {
      llamadas.push(['obtener', ctx, id]);
      return respuestas.una ?? null;
    },
  };
  return { uc: new ConsultOwnServiceRequestsUseCase({ serviceRequestRepository: repo }), llamadas };
}

test('SCRUM-871: lista las solicitudes con el tenant y el usuario del token, no de otra fuente', async () => {
  const { uc, llamadas } = conRepo({ lista: [{ id: SOL }] });

  const r = await uc.listar({ user: { ...cliente, extra: 'ignorado' } });

  assert.deepEqual(r, [{ id: SOL }]);
  assert.deepEqual(llamadas, [['listar', cliente]]);
});

test('SCRUM-871: obtiene una solicitud propia', async () => {
  const { uc, llamadas } = conRepo({ una: { id: SOL, estado: 'ASIGNADA' } });

  const r = await uc.obtener({ user: cliente, solicitudId: SOL });

  assert.equal(r.estado, 'ASIGNADA');
  assert.deepEqual(llamadas, [['obtener', cliente, SOL]]);
});

test('SCRUM-871 C2/C3: inexistente o de otro cliente responde 404 sin distinguir', async () => {
  const { uc } = conRepo({ una: null });

  await assert.rejects(() => uc.obtener({ user: cliente, solicitudId: SOL }), (e) => e.statusCode === 404 && e.code === 'MANI-SOL-404');
});

test('SCRUM-871 C2: un id que no es UUID responde 400 sin consultar', async () => {
  const { uc, llamadas } = conRepo();

  await assert.rejects(() => uc.obtener({ user: cliente, solicitudId: 'abc' }), (e) => e.statusCode === 400 && e.code === 'MANI-SOL-400');
  await assert.rejects(() => uc.obtener({ user: cliente }), (e) => e.statusCode === 400);
  assert.equal(llamadas.length, 0);
});

test('SCRUM-871 C3: un aliado o un admin no consultan solicitudes de cliente (403)', async () => {
  const { uc, llamadas } = conRepo();

  for (const role of ['ALLY', 'ADMIN']) {
    await assert.rejects(() => uc.listar({ user: { ...cliente, role } }), (e) => e.statusCode === 403 && e.code === 'MANI-SOL-403C');
  }
  assert.equal(llamadas.length, 0);
});

test('SCRUM-871: sin sesión, sin tenant o con usuario que no es UUID responde 401', async () => {
  const { uc } = conRepo();

  for (const user of [undefined, { ...cliente, tenantId: undefined }, { ...cliente, userId: 'no-uuid' }]) {
    await assert.rejects(() => uc.listar({ user }), (e) => e.statusCode === 401);
  }
});

test('exige el repositorio', () => {
  assert.throws(() => new ConsultOwnServiceRequestsUseCase({}), /serviceRequestRepository/);
});
