const test = require('node:test');
const assert = require('node:assert/strict');
const RespondQuoteUseCase = require('../../../../src/application/useCases/quotes/RespondQuoteUseCase');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const COTIZACION = '77777777-7777-4777-8777-777777777777';
const cliente = { tenantId: TENANT, userId: USER, role: 'CLIENT' };

function fakeRepo() {
  const calls = [];
  return {
    calls,
    responder: async (ctx, datos) => {
      calls.push({ ctx, datos });
      return { cotizacion: { id: COTIZACION }, solicitud: { estado: datos.decision.solicitud } };
    },
  };
}

const responder = (repo, accion, body = {}, user = cliente, cotizacionId = COTIZACION) =>
  new RespondQuoteUseCase({ quoteRepository: repo }).execute({ user, cotizacionId, accion, body });

test('C1: cada decisión lleva su efecto sobre la cotización, la solicitud y el evento', async () => {
  const casos = [
    ['ACEPTAR', {}, 'ACEPTADA', 'ACEPTADA', 'COTIZACION_ACEPTADA', ''],
    ['RECHAZAR', { motivo: '  Muy costosa  ' }, 'RECHAZADA', 'RECHAZADA', 'COTIZACION_RECHAZADA', 'Muy costosa'],
    ['AJUSTAR', { comentario: 'Bajar materiales' }, 'AJUSTE_SOLICITADO', 'COTIZANDO', 'AJUSTE_SOLICITADO', 'Bajar materiales'],
  ];
  for (const [accion, body, cot, sol, evento, detalle] of casos) {
    const repo = fakeRepo();
    await responder(repo, accion, { ...body, tenantId: 'otro' });
    const { ctx, datos } = repo.calls[0];
    assert.deepEqual(ctx, cliente);
    assert.equal(datos.cotizacionId, COTIZACION);
    assert.deepEqual([datos.decision.cotizacion, datos.decision.solicitud, datos.decision.evento], [cot, sol, evento]);
    assert.equal(datos.detalle, detalle);
  }
});

test('el rechazo acepta el texto en comentario si no viene motivo', async () => {
  const repo = fakeRepo();
  await responder(repo, 'RECHAZAR', { comentario: 'No me sirve' });
  assert.equal(repo.calls[0].datos.detalle, 'No me sirve');
});

for (const [caso, accion, body] of [
  ['rechazo sin motivo', 'RECHAZAR', {}],
  ['rechazo con motivo corto', 'RECHAZAR', { motivo: 'no' }],
  ['ajuste sin comentario', 'AJUSTAR', { comentario: '  ' }],
  ['texto de más de 500 caracteres', 'ACEPTAR', { comentario: 'x'.repeat(501) }],
  ['texto que no es cadena', 'AJUSTAR', { comentario: 42 }],
]) {
  test(`C2: ${caso} → 400 MANI-COT-400 sin tocar la base`, async () => {
    const repo = fakeRepo();
    await assert.rejects(responder(repo, accion, body), { statusCode: 400, code: 'MANI-COT-400' });
    assert.equal(repo.calls.length, 0);
  });
}

test('C2: id de cotización que no es UUID → 400', async () => {
  const repo = fakeRepo();
  await assert.rejects(responder(repo, 'ACEPTAR', {}, cliente, 'abc'), { code: 'MANI-COT-400' });
  assert.equal(repo.calls.length, 0);
});

test('C3: aliado y admin no responden cotizaciones (403)', async () => {
  for (const role of ['ALLY', 'ADMIN']) {
    const repo = fakeRepo();
    await assert.rejects(responder(repo, 'ACEPTAR', {}, { ...cliente, role }), { statusCode: 403, code: 'MANI-COT-403' });
    assert.equal(repo.calls.length, 0);
  }
});

test('sin sesión → 401 MANI-COT-401', async () => {
  await assert.rejects(responder(fakeRepo(), 'ACEPTAR', {}, null), { statusCode: 401, code: 'MANI-COT-401' });
});

test('exige el repositorio', () => {
  assert.throws(() => new RespondQuoteUseCase({}), /quoteRepository es requerido/);
});
