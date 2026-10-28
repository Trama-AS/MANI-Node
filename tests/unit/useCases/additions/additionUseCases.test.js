const test = require('node:test');
const assert = require('node:assert/strict');
const RequestAdditionUseCase = require('../../../../src/application/useCases/additions/RequestAdditionUseCase');
const ListAdditionsUseCase = require('../../../../src/application/useCases/additions/ListAdditionsUseCase');
const RespondAdditionUseCase = require('../../../../src/application/useCases/additions/RespondAdditionUseCase');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';
const ADICION = '88888888-8888-4888-8888-888888888888';
const aliado = { tenantId: TENANT, userId: USER, role: 'ALLY' };
const cliente = { tenantId: TENANT, userId: USER, role: 'CLIENT' };
const MOTIVO = 'Tubería rota detrás del muro';

function repoQueRegistra(resultado = { adicion: { id: ADICION }, resumen: null, notificacionId: 'notif-1' }) {
  const llamadas = [];
  const metodo = (nombre) => async (ctx, datos) => {
    llamadas.push({ nombre, ctx, datos });
    return resultado;
  };
  return { repo: { solicitar: metodo('solicitar'), listarPorSolicitud: metodo('listar'), responder: metodo('responder') }, llamadas };
}

function notificadorQueRegistra() {
  const entregas = [];
  return { notificador: { entregar: async (ctx, datos) => entregas.push({ ctx, datos }) }, entregas };
}

const pedir = (repo, body, extra = {}) =>
  new RequestAdditionUseCase({ additionRepository: repo, ...extra }).execute({ user: aliado, solicitudId: SOLICITUD, body, correlationId: 'corr-1' });

test('los casos de uso exigen el repositorio', () => {
  assert.throws(() => new RequestAdditionUseCase({}), /additionRepository es requerido/);
  assert.throws(() => new ListAdditionsUseCase({}), /additionRepository es requerido/);
  assert.throws(() => new RespondAdditionUseCase({}), /additionRepository es requerido/);
});

test('pedir: normaliza los datos, los pasa al repositorio con la sesión y entrega el aviso al cliente', async () => {
  const { repo, llamadas } = repoQueRegistra();
  const { notificador, entregas } = notificadorQueRegistra();

  const r = await pedir(repo, { motivo: `  ${MOTIVO}  `, valorManoObra: '100.5', valorMateriales: 0, tiempoAdicionalMinutos: '90' }, { notificador });

  assert.deepEqual(r, { adicion: { id: ADICION }, resumen: null });
  assert.deepEqual(llamadas[0].ctx, aliado);
  assert.deepEqual(llamadas[0].datos, { solicitudId: SOLICITUD, motivo: MOTIVO, valorManoObra: 100.5, valorMateriales: 0, tiempoAdicionalMinutos: 90 });
  assert.deepEqual(entregas, [{ ctx: aliado, datos: { notificacionId: 'notif-1', correlationId: 'corr-1' } }]);
});

test('pedir: el tiempo adicional es opcional', async () => {
  const { repo, llamadas } = repoQueRegistra();
  await pedir(repo, { motivo: MOTIVO, valorManoObra: 10, valorMateriales: 0 });
  assert.equal(llamadas[0].datos.tiempoAdicionalMinutos, null);
});

test('pedir: rechaza datos inválidos con MANI-ADI-400 sin llegar al repositorio', async () => {
  const { repo, llamadas } = repoQueRegistra();
  const base = { motivo: MOTIVO, valorManoObra: 10, valorMateriales: 5 };
  for (const body of [
    { ...base, motivo: 'corto' },
    { ...base, motivo: 'x'.repeat(501) },
    { ...base, motivo: 123 },
    { ...base, motivo: undefined },
    { ...base, valorManoObra: -1 },
    { ...base, valorMateriales: '1.234' },
    { ...base, valorManoObra: undefined },
    { ...base, valorManoObra: 0, valorMateriales: 0 },
    { ...base, tiempoAdicionalMinutos: 0 },
    { ...base, tiempoAdicionalMinutos: 1.5 },
    { ...base, tiempoAdicionalMinutos: 'una hora' },
    { ...base, tiempoAdicionalMinutos: 7 * 24 * 60 + 1 },
  ]) {
    await assert.rejects(pedir(repo, body), { code: 'MANI-ADI-400' }, JSON.stringify(body));
  }
  assert.equal(llamadas.length, 0);
});

test('pedir: solo un aliado con sesión válida y un id de solicitud válido', async () => {
  const { repo } = repoQueRegistra();
  const uc = new RequestAdditionUseCase({ additionRepository: repo });
  const body = { motivo: MOTIVO, valorManoObra: 10, valorMateriales: 0 };
  await assert.rejects(uc.execute({ user: null, solicitudId: SOLICITUD, body }), { code: 'MANI-ADI-401' });
  await assert.rejects(uc.execute({ user: { ...aliado, userId: 'no-uuid' }, solicitudId: SOLICITUD, body }), { code: 'MANI-ADI-401' });
  await assert.rejects(uc.execute({ user: cliente, solicitudId: SOLICITUD, body }), { code: 'MANI-ADI-403' });
  await assert.rejects(uc.execute({ user: aliado, solicitudId: 'abc', body }), { code: 'MANI-ADI-400' });
});

test('listar: cliente y aliado consultan; otro rol no', async () => {
  const { repo, llamadas } = repoQueRegistra({ adiciones: [], resumen: null });
  const uc = new ListAdditionsUseCase({ additionRepository: repo });
  assert.deepEqual(await uc.execute({ user: cliente, solicitudId: SOLICITUD }), { adiciones: [], resumen: null });
  await uc.execute({ user: aliado, solicitudId: SOLICITUD });
  assert.deepEqual(llamadas.map((l) => l.datos), [SOLICITUD, SOLICITUD]);
  await assert.rejects(uc.execute({ user: { ...cliente, role: 'ADMIN' }, solicitudId: SOLICITUD }), { code: 'MANI-ADI-403' });
  await assert.rejects(uc.execute({ user: cliente, solicitudId: 'x' }), { code: 'MANI-ADI-400' });
});

test('responder: pasa la decisión y el comentario, y entrega el aviso al aliado', async () => {
  const { repo, llamadas } = repoQueRegistra();
  const { notificador, entregas } = notificadorQueRegistra();
  const uc = new RespondAdditionUseCase({ additionRepository: repo, notificador });

  await uc.execute({ user: cliente, adicionId: ADICION, accion: 'RECHAZAR', body: { comentario: '  No pactado ' }, correlationId: 'c' });
  await uc.execute({ user: cliente, adicionId: ADICION, accion: 'ACEPTAR' });

  assert.deepEqual(llamadas[0].datos, { adicionId: ADICION, decision: RespondAdditionUseCase.DECISIONES.RECHAZAR, comentario: 'No pactado' });
  assert.deepEqual(llamadas[1].datos.decision, { accion: 'ACEPTAR', adicion: 'ACEPTADA', evento: 'ADICION_ACEPTADA' });
  assert.equal(llamadas[1].datos.comentario, '');
  assert.equal(entregas.length, 2);
});

test('responder: solo el cliente, con id válido, comentario acotado y una decisión conocida', async () => {
  const { repo, llamadas } = repoQueRegistra();
  const uc = new RespondAdditionUseCase({ additionRepository: repo });
  await assert.rejects(uc.execute({ user: aliado, adicionId: ADICION, accion: 'ACEPTAR' }), { code: 'MANI-ADI-403' });
  await assert.rejects(uc.execute({ user: cliente, adicionId: 'x', accion: 'ACEPTAR' }), { code: 'MANI-ADI-400' });
  await assert.rejects(uc.execute({ user: cliente, adicionId: ADICION, accion: 'ACEPTAR', body: { comentario: 'x'.repeat(501) } }), {
    code: 'MANI-ADI-400',
  });
  await assert.rejects(uc.execute({ user: cliente, adicionId: ADICION, accion: 'ACEPTAR', body: { comentario: 5 } }), { code: 'MANI-ADI-400' });
  await assert.rejects(uc.execute({ user: cliente, adicionId: ADICION, accion: 'SUSPENDER' }), /Decisión desconocida/);
  assert.equal(llamadas.length, 0);
});
