const test = require('node:test');
const assert = require('node:assert/strict');
const PgQuoteRepository = require('../../../src/infrastructure/repositories/PgQuoteRepository');
const { DECISIONES } = require('../../../src/application/useCases/quotes/RespondQuoteUseCase');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const COTIZACION = '77777777-7777-4777-8777-777777777777';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';
const ctx = { tenantId: TENANT, userId: USER, role: 'CLIENT' };

const filaActual = { estado: 'PENDIENTE', aliado_id: 'aliado-1', solicitud_id: SOLICITUD, cliente_id: 'cliente-1', estado_solicitud: 'COTIZANDO' };
const filaCotizacion = (estado) => ({
  id: COTIZACION, solicitud_id: SOLICITUD, version: 2, estado,
  valor_mano_obra: '100.00', valor_materiales: '50.00', created_at: new Date('2026-10-27T00:00:00Z'),
});

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

const exito = (cambios = {}, estadoNuevo = 'ACEPTADA') => ({
  'FROM cliente c JOIN usuario u': { rows: [{ id: 'cliente-1' }] },
  'FOR UPDATE OF cot, s': { rows: [filaActual] },
  'UPDATE cotizacion SET estado': { rows: [filaCotizacion(estadoNuevo)] },
  ...cambios,
});

const responder = (factory, accion = 'ACEPTAR', detalle = '') =>
  new PgQuoteRepository({ pgPoolFactory: factory }).responder(ctx, {
    cotizacionId: COTIZACION,
    decision: DECISIONES[accion],
    detalle,
  });

test('aceptar: cotización, solicitud, evento y notificación al aliado en una sola transacción', async () => {
  const { factory, sentencias } = fakeFactory(exito());

  const r = await responder(factory);

  assert.equal(r.cotizacion.estado, 'ACEPTADA');
  assert.deepEqual(r.solicitud, { id: SOLICITUD, estado: 'ACEPTADA' });
  assert.equal(sentencias[0].sql, 'BEGIN');
  assert.deepEqual(sentencias[1].params, [TENANT, USER, 'cliente']);
  const bloqueo = sentencias.find((s) => s.sql.includes('FOR UPDATE OF cot, s'));
  assert.deepEqual(bloqueo.params, [COTIZACION, TENANT]);
  assert.deepEqual(sentencias.find((s) => s.sql.startsWith('UPDATE cotizacion')).params, ['ACEPTADA', COTIZACION, TENANT]);
  assert.deepEqual(sentencias.find((s) => s.sql.startsWith('UPDATE solicitud')).params, ['ACEPTADA', SOLICITUD, TENANT]);
  const evento = sentencias.find((s) => s.sql.startsWith('INSERT INTO evento_servicio'));
  assert.deepEqual(evento.params, [TENANT, SOLICITUD, USER, 'COTIZACION_ACEPTADA', 'Cotización v2']);
  const aviso = sentencias.find((s) => s.sql.startsWith('INSERT INTO notificacion'));
  assert.match(aviso.sql, /'RESPUESTA_COTIZACION', 'PUSH'/);
  assert.deepEqual(aviso.params.slice(0, 2), [TENANT, 'aliado-1']);
  assert.deepEqual(JSON.parse(aviso.params[2]), { requestId: SOLICITUD, cotizacionId: COTIZACION, version: 2, decision: 'ACEPTAR' });
  assert.equal(sentencias.at(-1).sql, 'COMMIT');
});

test('pedir ajuste deja la solicitud en COTIZANDO y guarda el comentario en el evento', async () => {
  const { factory, sentencias } = fakeFactory(exito({}, 'AJUSTE_SOLICITADO'));

  const r = await responder(factory, 'AJUSTAR', 'Bajar materiales');

  assert.equal(r.solicitud.estado, 'COTIZANDO');
  const evento = sentencias.find((s) => s.sql.startsWith('INSERT INTO evento_servicio'));
  assert.deepEqual(evento.params.slice(3), ['AJUSTE_SOLICITADO', 'Cotización v2: Bajar materiales']);
});

test('C3: usuario sin cliente activo → 403 MANI-COT-403C y ROLLBACK', async () => {
  const { factory, sentencias } = fakeFactory(exito({ 'FROM cliente c JOIN usuario u': { rows: [] } }));
  await assert.rejects(responder(factory), { statusCode: 403, code: 'MANI-COT-403C' });
  assert.equal(sentencias.at(-1).sql, 'ROLLBACK');
  assert.ok(!sentencias.some((s) => s.sql.includes('FOR UPDATE')));
});

test('C3: cotización inexistente o de otro cliente → 404 MANI-COT-404 sin transición', async () => {
  for (const filas of [[], [{ ...filaActual, cliente_id: 'cliente-2' }]]) {
    const { factory, sentencias } = fakeFactory(exito({ 'FOR UPDATE OF cot, s': { rows: filas } }));
    await assert.rejects(responder(factory), { statusCode: 404, code: 'MANI-COT-404' });
    assert.ok(!sentencias.some((s) => s.sql.startsWith('UPDATE')));
  }
});

test('C2: cotización ya respondida → 409 MANI-COT-409R sin transición parcial', async () => {
  for (const estado of ['ACEPTADA', 'RECHAZADA', 'AJUSTE_SOLICITADO', 'EXPIRADA']) {
    const { factory, sentencias } = fakeFactory(exito({ 'FOR UPDATE OF cot, s': { rows: [{ ...filaActual, estado }] } }));
    await assert.rejects(responder(factory), { statusCode: 409, code: 'MANI-COT-409R' });
    assert.ok(!sentencias.some((s) => s.sql.startsWith('UPDATE') || s.sql.startsWith('INSERT')));
    assert.equal(sentencias.at(-1).sql, 'ROLLBACK');
  }
});

test('C2: solicitud fuera de COTIZANDO → 409 MANI-COT-409E', async () => {
  const { factory } = fakeFactory(
    exito({ 'FOR UPDATE OF cot, s': { rows: [{ ...filaActual, estado_solicitud: 'CANCELADA' }] } })
  );
  await assert.rejects(responder(factory), { statusCode: 409, code: 'MANI-COT-409E' });
});
