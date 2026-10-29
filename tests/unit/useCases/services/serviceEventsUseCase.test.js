const test = require('node:test');
const assert = require('node:assert/strict');
const ServiceEventsUseCase = require('../../../../src/application/useCases/services/ServiceEventsUseCase');
const { ConflictError } = require('../../../../src/domain/errors/DomainError');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';
const CLAVE = '88888888-8888-4888-8888-888888888888';
const aliado = { tenantId: TENANT, userId: USER, role: 'ALLY' };
const foto = { mimetype: 'image/png', buffer: Buffer.from('x'), originalname: 'fuga ñ.png' };

function dobles({ resultado = { evento: { id: 'e1' }, creado: true }, falla = null } = {}) {
  const calls = { registrar: [], subidas: [], borradas: [] };
  const repo = {
    registrar: async (ctx, datos) => {
      calls.registrar.push({ ctx, datos });
      if (falla) throw falla;
      return resultado;
    },
    listar: async () => [],
  };
  const storage = {
    upload: async (p) => {
      calls.subidas.push(p);
      return { path: `${p.bucket}/${p.path}` };
    },
    delete: async (ruta, opts) => calls.borradas.push([ruta, opts.bucket]),
  };
  return { calls, uc: new ServiceEventsUseCase({ serviceEventRepository: repo, fileStorageService: storage }) };
}

test('C1: registra tipo, observación y la ruta de la evidencia subida bajo {tenant}/{usuario}/eventos', async () => {
  const { calls, uc } = dobles();
  await uc.registrar({
    user: aliado,
    solicitudId: SOLICITUD,
    body: { tipo: 'avance', observacion: '  Cambié la tubería  ', claveIdempotencia: CLAVE, tenantId: 'otro' },
    file: foto,
  });

  const { ctx, datos } = calls.registrar[0];
  assert.deepEqual(ctx, aliado);
  assert.equal(datos.tipo, 'EJECUCION_AVANCE');
  assert.equal(datos.observacion, 'Cambié la tubería');
  assert.equal(datos.claveIdempotencia, CLAVE);
  assert.match(datos.evidenciaRuta, new RegExp(`^${TENANT}/${USER}/eventos/${SOLICITUD}/[0-9a-f-]{36}-fuga_n.?.png$`));
  assert.equal(calls.subidas[0].bucket, 'solicitudes');
  assert.equal(calls.borradas.length, 0);
});

test('sin tipo se registra como observación y sin foto no sube nada', async () => {
  const { calls, uc } = dobles();
  await uc.registrar({ user: aliado, solicitudId: SOLICITUD, body: { observacion: 'Todo bien' } });
  assert.equal(calls.registrar[0].datos.tipo, 'EJECUCION_OBSERVACION');
  assert.equal(calls.registrar[0].datos.evidenciaRuta, null);
  assert.equal(calls.subidas.length, 0);
});

for (const [caso, body, file] of [
  ['tipo desconocido', { tipo: 'FIESTA', observacion: 'ok ok' }, null],
  ['observación corta', { observacion: 'no' }, null],
  ['observación de más de 2000 caracteres', { observacion: 'x'.repeat(2001) }, null],
  ['evidencia como URL', { observacion: 'Foto', fotoUrl: 'http://x/y.png' }, null],
  ['evidencia que no es imagen', { observacion: 'Foto' }, { ...foto, mimetype: 'application/pdf' }],
  ['clave que no es UUID', { observacion: 'Foto', claveIdempotencia: 'abc' }, null],
  ['hora de captura que no es fecha', { observacion: 'Foto', ocurridoEn: 'ayer' }, null],
  ['hora de captura sin zona horaria', { observacion: 'Foto', ocurridoEn: '2026-10-28T10:15:00' }, null],
  ['hora de captura imposible', { observacion: 'Foto', ocurridoEn: '2026-13-40T10:15:00Z' }, null],
]) {
  test(`C2: ${caso} → 400 MANI-EVT-400 sin subir ni registrar`, async () => {
    const { calls, uc } = dobles();
    await assert.rejects(uc.registrar({ user: aliado, solicitudId: SOLICITUD, body, file }), {
      statusCode: 400,
      code: 'MANI-EVT-400',
    });
    assert.equal(calls.registrar.length, 0);
    assert.equal(calls.subidas.length, 0);
  });
}

test('SCRUM-873: la hora de captura llega al repositorio como fecha; sin ella va null y Core pone la del servidor', async () => {
  const { calls, uc } = dobles();
  await uc.registrar({
    user: aliado,
    solicitudId: SOLICITUD,
    body: { observacion: 'Sin señal', claveIdempotencia: CLAVE, ocurridoEn: ' 2026-10-28T10:15:30.120-05:00 ' },
  });
  await uc.registrar({ user: aliado, solicitudId: SOLICITUD, body: { observacion: 'En línea', ocurridoEn: '' } });

  assert.ok(calls.registrar[0].datos.ocurridoEn instanceof Date);
  assert.equal(calls.registrar[0].datos.ocurridoEn.toISOString(), '2026-10-28T15:15:30.120Z');
  assert.equal(calls.registrar[1].datos.ocurridoEn, null);
});

test('si el registro falla, la foto subida se borra y el error se propaga', async () => {
  const { calls, uc } = dobles({ falla: new ConflictError('MANI-EVT-409E: x', 'MANI-EVT-409E') });
  await assert.rejects(uc.registrar({ user: aliado, solicitudId: SOLICITUD, body: { observacion: 'Foto' }, file: foto }), {
    code: 'MANI-EVT-409E',
  });
  assert.deepEqual(calls.borradas, [[calls.subidas[0].path, 'solicitudes']]);
});

test('un reintento con la misma clave no deja una foto duplicada', async () => {
  const { calls, uc } = dobles({ resultado: { evento: { id: 'e1' }, creado: false } });
  const r = await uc.registrar({ user: aliado, solicitudId: SOLICITUD, body: { observacion: 'Foto', claveIdempotencia: CLAVE }, file: foto });
  assert.equal(r.creado, false);
  assert.equal(calls.borradas.length, 1);
});

test('C3: cliente y admin no registran eventos; el admin tampoco los consulta', async () => {
  for (const role of ['CLIENT', 'ADMIN']) {
    const { calls, uc } = dobles();
    await assert.rejects(uc.registrar({ user: { ...aliado, role }, solicitudId: SOLICITUD, body: { observacion: 'Hola' } }), {
      statusCode: 403,
      code: 'MANI-EVT-403',
    });
    assert.equal(calls.registrar.length, 0);
  }
  await assert.rejects(dobles().uc.listar({ user: { ...aliado, role: 'ADMIN' }, solicitudId: SOLICITUD }), { statusCode: 403 });
  assert.deepEqual(await dobles().uc.listar({ user: { ...aliado, role: 'CLIENT' }, solicitudId: SOLICITUD }), []);
});

test('sin sesión → 401 y exige sus dependencias', async () => {
  await assert.rejects(dobles().uc.registrar({ user: null, solicitudId: SOLICITUD }), { statusCode: 401, code: 'MANI-EVT-401' });
  assert.throws(() => new ServiceEventsUseCase({ fileStorageService: {} }), /serviceEventRepository es requerido/);
  assert.throws(() => new ServiceEventsUseCase({ serviceEventRepository: {} }), /fileStorageService es requerido/);
});
