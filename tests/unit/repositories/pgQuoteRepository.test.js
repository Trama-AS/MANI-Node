const test = require('node:test');
const assert = require('node:assert/strict');
const PgQuoteRepository = require('../../../src/infrastructure/repositories/PgQuoteRepository');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';
const ctx = { tenantId: TENANT, userId: USER, role: 'ALLY' };
const datos = { solicitudId: SOLICITUD, valorManoObra: 120000, valorMateriales: 35500.5 };

const filaCotizacion = {
  id: 'cot-1', solicitud_id: SOLICITUD, version: 2, estado: 'PENDIENTE',
  valor_mano_obra: '120000.00', valor_materiales: '35500.50', created_at: new Date('2026-10-27T00:00:00Z'),
};

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

const exito = (cambios = {}) => ({
  'FROM aliado WHERE usuario_id': { rows: [{ id: 'aliado-1' }] },
  'FROM solicitud WHERE id': { rows: [{ estado: 'ASIGNADA', aliado_id: 'aliado-1' }] },
  'FROM cotizacion WHERE solicitud_id = $1 AND tenant_id = $2': { rows: [{ ultima: 1, pendientes: 0 }] },
  'INSERT INTO cotizacion': { rows: [filaCotizacion] },
  ...cambios,
});

const emitir = (factory) => new PgQuoteRepository({ pgPoolFactory: factory }).emitir(ctx, datos);

test('emite la siguiente versión, pasa la solicitud a COTIZANDO y registra el evento en una sola transacción', async () => {
  const { factory, sentencias } = fakeFactory(exito());

  const cotizacion = await emitir(factory);

  assert.deepEqual(cotizacion, {
    id: 'cot-1', solicitudId: SOLICITUD, version: 2, estado: 'PENDIENTE',
    valorManoObra: 120000, valorMateriales: 35500.5, total: 155500.5, creadaEn: filaCotizacion.created_at,
  });
  assert.equal(sentencias[0].sql, 'BEGIN');
  assert.deepEqual(sentencias[1].params, [TENANT, USER, 'aliado']);
  const bloqueo = sentencias.find((s) => s.sql.includes('FROM solicitud WHERE id'));
  assert.match(bloqueo.sql, /FOR UPDATE$/);
  assert.deepEqual(bloqueo.params, [SOLICITUD, TENANT]);
  const insercion = sentencias.find((s) => s.sql.startsWith('INSERT INTO cotizacion'));
  assert.match(insercion.sql, /'PENDIENTE'/);
  assert.deepEqual(insercion.params, [TENANT, SOLICITUD, 'aliado-1', 120000, 35500.5, 2]);
  const transicion = sentencias.find((s) => s.sql.startsWith('UPDATE solicitud'));
  assert.match(transicion.sql, /estado = 'COTIZANDO'/);
  assert.deepEqual(transicion.params, [SOLICITUD, TENANT]);
  const evento = sentencias.find((s) => s.sql.startsWith('INSERT INTO evento_servicio'));
  assert.match(evento.sql, /'COTIZACION_ENVIADA'/);
  assert.deepEqual(evento.params.slice(0, 3), [TENANT, SOLICITUD, USER]);
  assert.match(evento.params[3], /v2: mano de obra 120000, materiales 35500.5, total 155500.5/);
  assert.equal(sentencias.at(-1).sql, 'COMMIT');
});

test('C3: usuario sin perfil de aliado en el tenant → 403 MANI-COT-403A y ROLLBACK', async () => {
  const { factory, sentencias } = fakeFactory(exito({ 'FROM aliado WHERE usuario_id': { rows: [] } }));
  await assert.rejects(emitir(factory), { statusCode: 403, code: 'MANI-COT-403A' });
  assert.equal(sentencias.at(-1).sql, 'ROLLBACK');
  assert.ok(!sentencias.some((s) => s.sql.startsWith('INSERT INTO cotizacion')));
});

test('C3: solicitud sin asignar o asignada a otro aliado → 403 MANI-COT-403A', async () => {
  for (const asignado of [null, 'aliado-2']) {
    const { factory, sentencias } = fakeFactory(
      exito({ 'FROM solicitud WHERE id': { rows: [{ estado: 'ASIGNADA', aliado_id: asignado }] } })
    );
    await assert.rejects(emitir(factory), { code: 'MANI-COT-403A' });
    assert.ok(!sentencias.some((s) => s.sql.startsWith('INSERT INTO cotizacion')));
  }
});

test('solicitud inexistente o de otro tenant → 404 MANI-COT-404', async () => {
  const { factory } = fakeFactory(exito({ 'FROM solicitud WHERE id': { rows: [] } }));
  await assert.rejects(emitir(factory), { statusCode: 404, code: 'MANI-COT-404' });
});

test('C2: estado incompatible → 409 MANI-COT-409E', async () => {
  for (const estado of ['PENDIENTE', 'ACEPTADA', 'EN_EJECUCION', 'FINALIZADA', 'CANCELADA']) {
    const { factory, sentencias } = fakeFactory(
      exito({ 'FROM solicitud WHERE id': { rows: [{ estado, aliado_id: 'aliado-1' }] } })
    );
    await assert.rejects(emitir(factory), { statusCode: 409, code: 'MANI-COT-409E' });
    assert.ok(!sentencias.some((s) => s.sql.startsWith('INSERT INTO cotizacion')));
  }
});

test('C2: ya hay una cotización pendiente → 409 MANI-COT-409P', async () => {
  const { factory, sentencias } = fakeFactory(
    exito({ 'FROM cotizacion WHERE solicitud_id = $1 AND tenant_id = $2': { rows: [{ ultima: 1, pendientes: 1 }] } })
  );
  await assert.rejects(emitir(factory), { statusCode: 409, code: 'MANI-COT-409P' });
  assert.ok(!sentencias.some((s) => s.sql.startsWith('UPDATE solicitud')));
});

test('primera cotización de una solicitud en COTIZANDO queda como versión 1', async () => {
  const { factory, sentencias } = fakeFactory(
    exito({
      'FROM solicitud WHERE id': { rows: [{ estado: 'COTIZANDO', aliado_id: 'aliado-1' }] },
      'FROM cotizacion WHERE solicitud_id = $1 AND tenant_id = $2': { rows: [{ ultima: 0, pendientes: 0 }] },
    })
  );
  await emitir(factory);
  assert.equal(sentencias.find((s) => s.sql.startsWith('INSERT INTO cotizacion')).params[5], 1);
});

test('lista las cotizaciones del cliente dueño o del aliado asignado, de la más reciente a la más antigua', async () => {
  const { factory, sentencias } = fakeFactory({
    'SELECT s.estado': { rows: [{}] },
    'FROM cotizacion': { rows: [filaCotizacion] },
  });
  const cliente = { ...ctx, role: 'CLIENT' };

  const lista = await new PgQuoteRepository({ pgPoolFactory: factory }).listarPorSolicitud(cliente, SOLICITUD);

  assert.equal(lista.length, 1);
  assert.equal(lista[0].total, 155500.5);
  const acceso = sentencias.find((s) => s.sql.startsWith('SELECT s.estado'));
  assert.deepEqual(acceso.params, [SOLICITUD, TENANT, 'CLIENT', USER]);
  assert.match(acceso.sql, /c\.usuario_id = \$4/);
  assert.match(acceso.sql, /a\.usuario_id = \$4/);
  const lectura = sentencias.find((s) => s.sql.includes('FROM cotizacion'));
  assert.match(lectura.sql, /ORDER BY version DESC/);
  assert.deepEqual(lectura.params, [SOLICITUD, TENANT]);
});

test('C3: para quien no es dueño ni aliado asignado la solicitud no existe (404)', async () => {
  const { factory, sentencias } = fakeFactory({ 'SELECT s.estado': { rows: [] } });
  await assert.rejects(new PgQuoteRepository({ pgPoolFactory: factory }).listarPorSolicitud(ctx, SOLICITUD), {
    statusCode: 404,
    code: 'MANI-COT-404',
  });
  assert.ok(!sentencias.some((s) => s.sql.includes('FROM cotizacion')));
});

test('sin DATABASE_URL responde 503 y exige pgPoolFactory', async () => {
  const repo = new PgQuoteRepository({ pgPoolFactory: { getPool: () => null } });
  await assert.rejects(repo.emitir(ctx, datos), { statusCode: 503 });
  assert.throws(() => new PgQuoteRepository({}), /pgPoolFactory es requerido/);
});
