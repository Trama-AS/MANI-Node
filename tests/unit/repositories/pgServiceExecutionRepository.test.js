const test = require('node:test');
const assert = require('node:assert/strict');
const PgServiceExecutionRepository = require('../../../src/infrastructure/repositories/PgServiceExecutionRepository');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';
const ctx = { tenantId: TENANT, userId: USER, role: 'ALLY' };
const HORA = new Date('2026-10-27T15:00:00Z');

// Pool simulado de `pg`: responde según la sentencia y registra el orden de la transacción.
function fakeFactory(respuestas = {}) {
  const sentencias = [];
  const client = {
    query: async (sql, params) => {
      sentencias.push({ sql: sql.trim(), params });
      for (const [clave, valor] of Object.entries(respuestas)) {
        if (sql.includes(clave)) return valor;
      }
      return { rows: [] };
    },
    release: () => {},
  };
  return { factory: { getPool: () => ({ connect: async () => client }) }, sentencias };
}

const fila = (estado, flujo = 'COTIZACION_PREVIA', aliado = 'aliado-1') => ({
  rows: [{ estado, aliado_id: aliado, cliente_usuario_id: 'usuario-cliente', flujo_operativo: flujo }],
});
const base = (solicitud) => ({
  'FROM aliado WHERE usuario_id': { rows: [{ id: 'aliado-1' }] },
  'FOR UPDATE OF s': solicitud,
  'INSERT INTO evento_servicio': { rows: [{ timestamp: HORA }] },
});

const marcar = (factory, hito, observacion = '') =>
  new PgServiceExecutionRepository({ pgPoolFactory: factory }).marcar(ctx, { solicitudId: SOLICITUD, hito, observacion });

test('inicio con cotización aceptada: EN_EJECUCION, evento con la hora del servidor y aviso al cliente', async () => {
  const { factory, sentencias } = fakeFactory(base(fila('ACEPTADA')));

  const r = await marcar(factory, 'INICIO', 'Llegué al sitio');

  assert.deepEqual(r, { solicitud: { id: SOLICITUD, estado: 'EN_EJECUCION' }, evento: { tipo: 'INICIO_EJECUCION', registradoEn: HORA } });
  assert.equal(sentencias[0].sql, 'BEGIN');
  assert.deepEqual(sentencias[1].params, [TENANT, USER, 'aliado']);
  assert.match(sentencias.find((s) => s.sql.includes('FOR UPDATE')).sql, /FOR UPDATE OF s$/);
  assert.deepEqual(sentencias.find((s) => s.sql.startsWith('UPDATE solicitud')).params, ['EN_EJECUCION', SOLICITUD, TENANT]);
  const evento = sentencias.find((s) => s.sql.startsWith('INSERT INTO evento_servicio'));
  assert.deepEqual(evento.params, [TENANT, SOLICITUD, USER, 'INICIO_EJECUCION', 'Llegué al sitio']);
  assert.match(evento.sql, /RETURNING timestamp/);
  const aviso = sentencias.find((s) => s.sql.startsWith('INSERT INTO notificacion'));
  assert.deepEqual(aviso.params.slice(0, 3), [TENANT, 'usuario-cliente', 'EJECUCION_INICIADA']);
  assert.equal(sentencias.at(-1).sql, 'COMMIT');
});

test('TARIFA_ESTANDAR se inicia desde la asignación, sin cotización', async () => {
  const { factory } = fakeFactory(base(fila('ASIGNADA', 'TARIFA_ESTANDAR')));
  const r = await marcar(factory, 'INICIO');
  assert.equal(r.solicitud.estado, 'EN_EJECUCION');
});

test('fin desde EN_EJECUCION: FINALIZADA y aviso EJECUCION_FINALIZADA; sin observación guarda NULL', async () => {
  const { factory, sentencias } = fakeFactory(base(fila('EN_EJECUCION')));
  const r = await marcar(factory, 'FIN');
  assert.equal(r.solicitud.estado, 'FINALIZADA');
  assert.equal(sentencias.find((s) => s.sql.startsWith('INSERT INTO evento_servicio')).params[4], null);
  assert.equal(sentencias.find((s) => s.sql.startsWith('INSERT INTO notificacion')).params[2], 'EJECUCION_FINALIZADA');
});

for (const [caso, hito, estado, flujo, codigo] of [
  ['iniciar con la cotización sin aceptar', 'INICIO', 'COTIZANDO', 'COTIZACION_PREVIA', 'MANI-EJE-409E'],
  ['iniciar asignada con cotización previa', 'INICIO', 'ASIGNADA', 'COTIZACION_PREVIA', 'MANI-EJE-409E'],
  ['iniciar dos veces', 'INICIO', 'EN_EJECUCION', 'COTIZACION_PREVIA', 'MANI-EJE-409I'],
  ['iniciar lo ya finalizado', 'INICIO', 'FINALIZADA', 'COTIZACION_PREVIA', 'MANI-EJE-409F'],
  ['finalizar antes de iniciar', 'FIN', 'ACEPTADA', 'COTIZACION_PREVIA', 'MANI-EJE-409N'],
  ['finalizar dos veces', 'FIN', 'FINALIZADA', 'COTIZACION_PREVIA', 'MANI-EJE-409F'],
]) {
  test(`C2: ${caso} → 409 ${codigo} sin transición parcial`, async () => {
    const { factory, sentencias } = fakeFactory(base(fila(estado, flujo)));
    await assert.rejects(marcar(factory, hito), { statusCode: 409, code: codigo });
    assert.ok(!sentencias.some((s) => s.sql.startsWith('UPDATE') || s.sql.startsWith('INSERT')));
    assert.equal(sentencias.at(-1).sql, 'ROLLBACK');
  });
}

test('C3: sin perfil de aliado o con otro aliado asignado → 403 MANI-EJE-403A; inexistente → 404', async () => {
  let r = fakeFactory({ ...base(fila('ACEPTADA')), 'FROM aliado WHERE usuario_id': { rows: [] } });
  await assert.rejects(marcar(r.factory, 'INICIO'), { statusCode: 403, code: 'MANI-EJE-403A' });
  r = fakeFactory(base(fila('ACEPTADA', 'COTIZACION_PREVIA', 'aliado-2')));
  await assert.rejects(marcar(r.factory, 'INICIO'), { statusCode: 403, code: 'MANI-EJE-403A' });
  r = fakeFactory(base({ rows: [] }));
  await assert.rejects(marcar(r.factory, 'INICIO'), { statusCode: 404, code: 'MANI-EJE-404' });
});

test('consultar devuelve inicio y fin al dueño o al aliado; para otro usuario 404', async () => {
  const fin = new Date('2026-10-27T17:30:00Z');
  const { factory, sentencias } = fakeFactory({
    'SELECT s.estado': { rows: [{ estado: 'FINALIZADA' }] },
    'FROM evento_servicio': {
      rows: [
        { tipo_evento: 'FIN_EJECUCION', timestamp: fin, descripcion: null },
        { tipo_evento: 'INICIO_EJECUCION', timestamp: HORA, descripcion: 'Llegué' },
      ],
    },
  });
  const cliente = { ...ctx, role: 'CLIENT' };
  const r = await new PgServiceExecutionRepository({ pgPoolFactory: factory }).consultar(cliente, SOLICITUD);
  assert.deepEqual(r, {
    solicitudId: SOLICITUD,
    estado: 'FINALIZADA',
    inicio: { registradoEn: HORA, observacion: 'Llegué' },
    fin: { registradoEn: fin, observacion: null },
  });
  assert.deepEqual(sentencias.find((s) => s.sql.startsWith('SELECT s.estado')).params, [SOLICITUD, TENANT, 'CLIENT', USER]);

  const otro = fakeFactory();
  await assert.rejects(new PgServiceExecutionRepository({ pgPoolFactory: otro.factory }).consultar(cliente, SOLICITUD), {
    code: 'MANI-EJE-404',
  });
});

test('sin DATABASE_URL responde 503 y exige pgPoolFactory', async () => {
  await assert.rejects(new PgServiceExecutionRepository({ pgPoolFactory: { getPool: () => null } }).marcar(ctx, {}), {
    statusCode: 503,
  });
  assert.throws(() => new PgServiceExecutionRepository({}), /pgPoolFactory es requerido/);
});
