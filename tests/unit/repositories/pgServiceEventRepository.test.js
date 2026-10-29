const test = require('node:test');
const assert = require('node:assert/strict');
const PgServiceEventRepository = require('../../../src/infrastructure/repositories/PgServiceEventRepository');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';
const CLAVE = '88888888-8888-4888-8888-888888888888';
const ctx = { tenantId: TENANT, userId: USER, role: 'ALLY' };
const HORA = new Date('2026-10-27T16:00:00Z');
const filaEvento = {
  id: 'ev-1', tipo_evento: 'EJECUCION_AVANCE', descripcion: 'Cambié la tubería', timestamp: HORA, ocurrido_en: HORA,
  actor_id: USER, actor_rol: 'ALIADO', tiene_evidencia: true,
};
const datos = { solicitudId: SOLICITUD, tipo: 'EJECUCION_AVANCE', observacion: 'Cambié la tubería', evidenciaRuta: 'r/f.png', claveIdempotencia: null };

// Pool simulado de `pg`: responde según la sentencia (o con una función) y registra el orden.
function fakeFactory(respuestas = {}) {
  const sentencias = [];
  const client = {
    query: async (sql, params) => {
      sentencias.push({ sql: sql.trim(), params });
      for (const [clave, valor] of Object.entries(respuestas)) {
        if (sql.includes(clave)) return typeof valor === 'function' ? valor() : valor;
      }
      return { rows: [] };
    },
    release: () => {},
  };
  return { factory: { getPool: () => ({ connect: async () => client }) }, sentencias };
}

const base = (estado = 'EN_EJECUCION', extra = {}) => ({
  'FROM aliado WHERE usuario_id': { rows: [{ id: 'aliado-1' }] },
  'FOR UPDATE': { rows: [{ estado, aliado_id: 'aliado-1' }] },
  'WITH nuevo AS': { rows: [filaEvento] },
  ...extra,
});

const registrar = (factory, d = datos) => new PgServiceEventRepository({ pgPoolFactory: factory }).registrar(ctx, d);

test('C1: registra en ejecución con autor, rol, hora del servidor y evidencia', async () => {
  const { factory, sentencias } = fakeFactory(base());

  const r = await registrar(factory);

  assert.deepEqual(r, {
    creado: true,
    evento: {
      id: 'ev-1', tipo: 'EJECUCION_AVANCE', descripcion: 'Cambié la tubería', ocurridoEn: HORA, registradoEn: HORA,
      autor: { id: USER, rol: 'ALIADO' }, tieneEvidencia: true,
    },
  });
  assert.equal(sentencias[0].sql, 'BEGIN');
  assert.deepEqual(sentencias[1].params, [TENANT, USER, 'aliado']);
  const insercion = sentencias.find((s) => s.sql.startsWith('WITH nuevo AS'));
  assert.deepEqual(insercion.params, [TENANT, SOLICITUD, USER, 'EJECUCION_AVANCE', 'Cambié la tubería', 'r/f.png', null, null]);
  assert.equal(sentencias.at(-1).sql, 'COMMIT');
});

test('idempotencia: una clave ya registrada devuelve el evento existente sin insertar', async () => {
  const { factory, sentencias } = fakeFactory(base('EN_EJECUCION', { 'e.clave_idempotencia = $3': { rows: [filaEvento] } }));
  const r = await registrar(factory, { ...datos, claveIdempotencia: CLAVE });
  assert.equal(r.creado, false);
  assert.equal(r.evento.id, 'ev-1');
  assert.ok(!sentencias.some((s) => s.sql.startsWith('WITH nuevo AS')));
});

test('idempotencia: si otro envío gana la carrera, se vuelve al savepoint y se devuelve el ganador', async () => {
  let consultas = 0;
  const { factory, sentencias } = fakeFactory(
    base('EN_EJECUCION', {
      'e.clave_idempotencia = $3': () => ({ rows: consultas++ === 0 ? [] : [filaEvento] }),
      'WITH nuevo AS': () => {
        throw Object.assign(new Error('duplicada'), { code: '23505' });
      },
    })
  );
  const r = await registrar(factory, { ...datos, claveIdempotencia: CLAVE });
  assert.equal(r.creado, false);
  assert.ok(sentencias.some((s) => s.sql === 'ROLLBACK TO SAVEPOINT registrar_evento'));
  assert.equal(sentencias.at(-1).sql, 'COMMIT');
});

test('C2: fuera de la ejecución → 409 MANI-EVT-409E sin insertar', async () => {
  for (const estado of ['ACEPTADA', 'FINALIZADA', 'CANCELADA']) {
    const { factory, sentencias } = fakeFactory(base(estado));
    await assert.rejects(registrar(factory), { statusCode: 409, code: 'MANI-EVT-409E' });
    assert.ok(!sentencias.some((s) => s.sql.startsWith('WITH nuevo AS')));
    assert.equal(sentencias.at(-1).sql, 'ROLLBACK');
  }
});

test('SCRUM-873: con hora de captura entra en ejecución o finalizado si cae dentro de la ejecución', async () => {
  const minutos = (n) => new Date(HORA.getTime() + n * 60 * 1000);
  const ventana = (fin = null) => ({ 'AS ahora': { rows: [{ ahora: HORA, inicio: minutos(-120), fin }] } });

  // En ejecución: se guarda la hora de captura; hasta 5 minutos adelante por el reloj del teléfono.
  for (const ocurridoEn of [minutos(-60), minutos(5)]) {
    const { factory, sentencias } = fakeFactory(base('EN_EJECUCION', ventana()));
    assert.equal((await registrar(factory, { ...datos, ocurridoEn })).creado, true);
    const insercion = sentencias.find((s) => s.sql.startsWith('WITH nuevo AS'));
    assert.equal(insercion.params.at(-1), ocurridoEn);
    assert.deepEqual(sentencias.find((s) => s.sql.includes('AS ahora')).params, [SOLICITUD, TENANT]);
  }
  // Finalizado: entra lo tomado antes del fin aunque llegue después.
  const { factory } = fakeFactory(base('FINALIZADA', ventana(minutos(-30))));
  assert.equal((await registrar(factory, { ...datos, ocurridoEn: minutos(-45) })).creado, true);
});

test('SCRUM-873: hora de captura en el futuro, fuera de la ejecución o con el servicio cancelado se rechaza sin insertar', async () => {
  const minutos = (n) => new Date(HORA.getTime() + n * 60 * 1000);
  for (const [estado, ventana, ocurridoEn, statusCode, code] of [
    ['EN_EJECUCION', { inicio: minutos(-120), fin: null }, minutos(6), 400, 'MANI-EVT-400F'],
    ['EN_EJECUCION', { inicio: minutos(-120), fin: null }, minutos(-121), 409, 'MANI-EVT-409T'],
    ['EN_EJECUCION', { inicio: null, fin: null }, minutos(-1), 409, 'MANI-EVT-409T'],
    ['FINALIZADA', { inicio: minutos(-120), fin: minutos(-30) }, minutos(-29), 409, 'MANI-EVT-409T'],
    ['FINALIZADA', { inicio: minutos(-120), fin: null }, minutos(-29), 409, 'MANI-EVT-409T'],
    ['CANCELADA', { inicio: minutos(-120), fin: null }, minutos(-60), 409, 'MANI-EVT-409E'],
    ['ACEPTADA', { inicio: null, fin: null }, minutos(-60), 409, 'MANI-EVT-409E'],
  ]) {
    const { factory, sentencias } = fakeFactory(base(estado, { 'AS ahora': { rows: [{ ahora: HORA, ...ventana }] } }));
    await assert.rejects(registrar(factory, { ...datos, ocurridoEn }), { statusCode, code });
    assert.ok(!sentencias.some((s) => s.sql.startsWith('WITH nuevo AS')));
    assert.equal(sentencias.at(-1).sql, 'ROLLBACK');
  }
});

test('C3: sin perfil de aliado u otro aliado → 403 MANI-EVT-403A; inexistente → 404', async () => {
  let r = fakeFactory({ ...base(), 'FROM aliado WHERE usuario_id': { rows: [] } });
  await assert.rejects(registrar(r.factory), { code: 'MANI-EVT-403A' });
  r = fakeFactory({ ...base(), 'FOR UPDATE': { rows: [{ estado: 'EN_EJECUCION', aliado_id: 'aliado-2' }] } });
  await assert.rejects(registrar(r.factory), { code: 'MANI-EVT-403A' });
  r = fakeFactory({ ...base(), 'FOR UPDATE': { rows: [] } });
  await assert.rejects(registrar(r.factory), { statusCode: 404, code: 'MANI-EVT-404' });
});

test('listar: secuencia ordenada por hora para el dueño o el aliado; para otro 404', async () => {
  const { factory, sentencias } = fakeFactory({ 'SELECT s.estado': { rows: [{ estado: 'EN_EJECUCION' }] }, 'ORDER BY COALESCE(e.ocurrido_en, e.timestamp), e.timestamp, e.id': { rows: [filaEvento] } });
  const cliente = { ...ctx, role: 'CLIENT' };
  const lista = await new PgServiceEventRepository({ pgPoolFactory: factory }).listar(cliente, SOLICITUD);
  assert.equal(lista[0].autor.rol, 'ALIADO');
  assert.deepEqual(sentencias.find((s) => s.sql.startsWith('SELECT s.estado')).params, [SOLICITUD, TENANT, 'CLIENT', USER]);

  const otro = fakeFactory();
  await assert.rejects(new PgServiceEventRepository({ pgPoolFactory: otro.factory }).listar(cliente, SOLICITUD), {
    code: 'MANI-EVT-404',
  });
});

test('sin DATABASE_URL responde 503 y exige pgPoolFactory', async () => {
  await assert.rejects(new PgServiceEventRepository({ pgPoolFactory: { getPool: () => null } }).listar(ctx, SOLICITUD), {
    statusCode: 503,
  });
  assert.throws(() => new PgServiceEventRepository({}), /pgPoolFactory es requerido/);
});
