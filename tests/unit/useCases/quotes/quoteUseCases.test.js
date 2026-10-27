const test = require('node:test');
const assert = require('node:assert/strict');
const CreateQuoteUseCase = require('../../../../src/application/useCases/quotes/CreateQuoteUseCase');
const ListQuotesUseCase = require('../../../../src/application/useCases/quotes/ListQuotesUseCase');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';
const aliado = { tenantId: TENANT, userId: USER, role: 'ALLY' };

function fakeRepo() {
  const calls = [];
  return {
    calls,
    emitir: async (ctx, datos) => {
      calls.push({ metodo: 'emitir', ctx, datos });
      return { id: 'cot-1', version: 1, ...datos };
    },
    listarPorSolicitud: async (ctx, solicitudId) => {
      calls.push({ metodo: 'listar', ctx, solicitudId });
      return [];
    },
  };
}

const crear = (repo, body, user = aliado, solicitudId = SOLICITUD) =>
  new CreateQuoteUseCase({ quoteRepository: repo }).execute({ user, solicitudId, body });

test('C1: separa mano de obra y materiales y pasa el contexto del token al repositorio', async () => {
  const repo = fakeRepo();
  await crear(repo, { valorManoObra: 120000, valorMateriales: '35500.50', total: 155500.5, tenantId: 'otro' });

  assert.deepEqual(repo.calls[0].ctx, aliado);
  assert.deepEqual(repo.calls[0].datos, { solicitudId: SOLICITUD, valorManoObra: 120000, valorMateriales: 35500.5 });
});

test('C1: materiales en cero es válido si la mano de obra tiene valor', async () => {
  const repo = fakeRepo();
  await crear(repo, { valorManoObra: '80000', valorMateriales: 0 });
  assert.equal(repo.calls[0].datos.valorMateriales, 0);
});

test('C1: el total se compara en centavos, sin errores de coma flotante', async () => {
  const repo = fakeRepo();
  await crear(repo, { valorManoObra: 0.1, valorMateriales: 0.2, total: 0.3 });
  assert.equal(repo.calls.length, 1);
});

for (const [caso, body] of [
  ['falta la mano de obra', { valorMateriales: 100 }],
  ['faltan los materiales', { valorManoObra: 100 }],
  ['importe negativo', { valorManoObra: -1, valorMateriales: 0 }],
  ['más de dos decimales', { valorManoObra: '10.555', valorMateriales: 0 }],
  ['texto no numérico', { valorManoObra: 'mil', valorMateriales: 0 }],
  ['notación científica', { valorManoObra: '1e5', valorMateriales: 0 }],
  ['tipo no admitido', { valorManoObra: true, valorMateriales: 0 }],
  ['supera DECIMAL(12,2)', { valorManoObra: '12345678901', valorMateriales: 0 }],
  ['total en cero', { valorManoObra: 0, valorMateriales: '0.00' }],
  ['total que no coincide', { valorManoObra: 100, valorMateriales: 50, total: 160 }],
  ['total no numérico', { valorManoObra: 100, valorMateriales: 50, total: 'x' }],
]) {
  test(`C2: ${caso} → 400 MANI-COT-400 sin tocar la base`, async () => {
    const repo = fakeRepo();
    await assert.rejects(crear(repo, body), (err) => err.statusCode === 400 && err.code === 'MANI-COT-400');
    assert.equal(repo.calls.length, 0);
  });
}

test('C2: un id de solicitud que no es UUID → 400', async () => {
  const repo = fakeRepo();
  await assert.rejects(crear(repo, { valorManoObra: 1, valorMateriales: 0 }, aliado, 'abc'), { code: 'MANI-COT-400' });
  assert.equal(repo.calls.length, 0);
});

test('C3: cliente y admin no emiten cotizaciones (403)', async () => {
  for (const role of ['CLIENT', 'ADMIN']) {
    const repo = fakeRepo();
    await assert.rejects(crear(repo, { valorManoObra: 1, valorMateriales: 0 }, { ...aliado, role }), {
      statusCode: 403,
      code: 'MANI-COT-403',
    });
    assert.equal(repo.calls.length, 0);
  }
});

test('sin sesión o con usuario que no es UUID → 401', async () => {
  for (const user of [null, { tenantId: TENANT, role: 'ALLY' }, { ...aliado, userId: 'user-1' }]) {
    await assert.rejects(crear(fakeRepo(), { valorManoObra: 1, valorMateriales: 0 }, user), {
      statusCode: 401,
      code: 'MANI-COT-401',
    });
  }
});

test('C3: cliente y aliado consultan; el admin no', async () => {
  for (const role of ['CLIENT', 'ALLY']) {
    const repo = fakeRepo();
    await new ListQuotesUseCase({ quoteRepository: repo }).execute({ user: { ...aliado, role }, solicitudId: SOLICITUD });
    assert.deepEqual(repo.calls[0], { metodo: 'listar', ctx: { ...aliado, role }, solicitudId: SOLICITUD });
  }
  await assert.rejects(
    new ListQuotesUseCase({ quoteRepository: fakeRepo() }).execute({ user: { ...aliado, role: 'ADMIN' }, solicitudId: SOLICITUD }),
    { statusCode: 403 }
  );
});

test('los casos de uso exigen el repositorio', () => {
  assert.throws(() => new CreateQuoteUseCase({}), /quoteRepository es requerido/);
  assert.throws(() => new ListQuotesUseCase({}), /quoteRepository es requerido/);
});
