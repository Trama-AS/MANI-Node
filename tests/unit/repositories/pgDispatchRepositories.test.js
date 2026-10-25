const test = require('node:test');
const assert = require('node:assert/strict');

const PgElegibilidadRepository = require('../../../src/infrastructure/repositories/PgElegibilidadRepository');
const PgSolicitudContextRepository = require('../../../src/infrastructure/repositories/PgSolicitudContextRepository');
const PgNotificacionRepository = require('../../../src/infrastructure/repositories/PgNotificacionRepository');

const TENANT = '11111111-1111-4111-8111-111111111111';
const CATEGORIA = '33333333-3333-4333-8333-333333333333';
const ZONA = '44444444-4444-4444-8444-444444444444';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';
const ALLY = '66666666-6666-4666-8666-666666666666';

// Pool simulado: registra cada consulta y responde con las filas que entrega `answer`.
function fakeFactory(answer) {
  const queries = [];
  const pool = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      return answer(sql, params, queries.length);
    },
  };
  return { factory: { getPool: () => pool }, queries };
}

test('elegibilidad: una sola consulta con el tenant como primer parámetro y mapea las filas', async () => {
  const { factory, queries } = fakeFactory(() => ({
    rows: [{
      total: 3,
      allies: [{ id: ALLY, nombre_razon_social: 'Ana', tipo: 'PERSONA_NATURAL', estado_verificacion: 'VERIFICADO' }],
    }],
  }));
  const repo = new PgElegibilidadRepository({ pgPoolFactory: factory });

  const result = await repo.findEligible({
    tenantId: TENANT, categoriaId: CATEGORIA, zonaId: ZONA, requestId: SOLICITUD, tipo: 'PERSONA_NATURAL', page: 3, pageSize: 10,
  });

  assert.deepEqual(result, {
    allies: [{ id: ALLY, nombreRazonSocial: 'Ana', tipo: 'PERSONA_NATURAL', estadoVerificacion: 'VERIFICADO' }],
    totalCount: 3,
  });
  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].params, [TENANT, CATEGORIA, ZONA, 'PERSONA_NATURAL', SOLICITUD, 20, 10]);
  assert.match(queries[0].sql, /a\.tenant_id = \$1/);
  assert.match(queries[0].sql, /estado_verificacion = 'VERIFICADO'/);
  assert.match(queries[0].sql, /aa\.inicio <= now\(\) AND aa\.fin > now\(\)/);
});

test('elegibilidad: sin tipo ni requestId envía null y devuelve lista vacía', async () => {
  const { factory, queries } = fakeFactory(() => ({ rows: [{ total: 0, allies: [] }] }));
  const repo = new PgElegibilidadRepository({ pgPoolFactory: factory });

  const result = await repo.findEligible({ tenantId: TENANT, categoriaId: CATEGORIA, zonaId: ZONA, page: 1, pageSize: 20 });

  assert.deepEqual(result, { allies: [], totalCount: 0 });
  assert.deepEqual(queries[0].params, [TENANT, CATEGORIA, ZONA, null, null, 0, 20]);
});

test('elegibilidad: un error de la base se propaga', async () => {
  const { factory } = fakeFactory(() => {
    throw new Error('conexión perdida');
  });
  const repo = new PgElegibilidadRepository({ pgPoolFactory: factory });

  await assert.rejects(
    () => repo.findEligible({ tenantId: TENANT, categoriaId: CATEGORIA, zonaId: ZONA, page: 1, pageSize: 20 }),
    /conexión perdida/
  );
});

test('repositorios: exigen pgPoolFactory', () => {
  assert.throws(() => new PgElegibilidadRepository({}), /pgPoolFactory/);
  assert.throws(() => new PgSolicitudContextRepository({}), /pgPoolFactory/);
  assert.throws(() => new PgNotificacionRepository({}), /pgPoolFactory/);
});

test('contexto: filtra por id y tenant y mapea la fila', async () => {
  const { factory, queries } = fakeFactory(() => ({
    rows: [{ id: SOLICITUD, tenant_id: TENANT, zona_id: ZONA, categoria_id: CATEGORIA, estado: 'PENDIENTE' }],
  }));
  const repo = new PgSolicitudContextRepository({ pgPoolFactory: factory });

  const context = await repo.findContext(TENANT, SOLICITUD);

  assert.deepEqual(context, { id: SOLICITUD, tenantId: TENANT, zonaId: ZONA, categoriaId: CATEGORIA, estado: 'PENDIENTE' });
  assert.deepEqual(queries[0].params, [SOLICITUD, TENANT]);
  assert.match(queries[0].sql, /tenant_id = \$2/);
});

test('contexto: sin filas devuelve null', async () => {
  const { factory } = fakeFactory(() => ({ rows: [] }));

  assert.equal(await new PgSolicitudContextRepository({ pgPoolFactory: factory }).findContext(TENANT, SOLICITUD), null);
});

test('notificaciones: inserta para el usuario del aliado del mismo tenant y devuelve el id', async () => {
  const { factory, queries } = fakeFactory(() => ({ rows: [{ id: 'n-1', usuario_id: 'u-1' }] }));
  const repo = new PgNotificacionRepository({ pgPoolFactory: factory });
  const payload = { requestId: SOLICITUD, estado: 'ENVIADA' };

  const created = await repo.createForAlly({ tenantId: TENANT, allyId: ALLY, tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload });

  assert.deepEqual(created, { id: 'n-1', usuarioId: 'u-1' });
  assert.deepEqual(queries[0].params, [TENANT, ALLY, 'OFERTA_DESPACHO', 'PUSH', JSON.stringify(payload)]);
  assert.match(queries[0].sql, /a\.tenant_id = \$1/);
});

test('notificaciones: un aliado que no es del tenant no inserta nada y devuelve null', async () => {
  const { factory } = fakeFactory(() => ({ rows: [] }));
  const repo = new PgNotificacionRepository({ pgPoolFactory: factory });

  assert.equal(
    await repo.createForAlly({ tenantId: TENANT, allyId: ALLY, tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload: {} }),
    null
  );
});

test('notificaciones: lista por tenant, tipo y solicitud y mapea payload y fecha', async () => {
  const sent = new Date('2026-10-18T10:00:00Z');
  const { factory, queries } = fakeFactory(() => ({ rows: [{ payload: { requestId: SOLICITUD }, enviado_at: sent }] }));
  const repo = new PgNotificacionRepository({ pgPoolFactory: factory });

  const rows = await repo.listByRequest(TENANT, SOLICITUD, 'OFERTA_DESPACHO');

  assert.deepEqual(rows, [{ payload: { requestId: SOLICITUD }, enviadoAt: sent }]);
  assert.deepEqual(queries[0].params, [TENANT, 'OFERTA_DESPACHO', SOLICITUD]);
  assert.match(queries[0].sql, /tenant_id = \$1/);
});

test('notificaciones: la bandeja lista solo las del usuario en su tenant, más recientes primero', async () => {
  const sent = new Date('2026-10-25T10:00:00Z');
  const { factory, queries } = fakeFactory(() => ({
    rows: [{ id: 'n-2', tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload: { requestId: SOLICITUD }, enviado_at: sent, leido_at: null }],
  }));
  const repo = new PgNotificacionRepository({ pgPoolFactory: factory });

  const rows = await repo.listForUser(TENANT, 'u-1', { limit: 20 });

  assert.deepEqual(rows, [
    { id: 'n-2', tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload: { requestId: SOLICITUD }, enviadoAt: sent, leidoAt: null },
  ]);
  assert.deepEqual(queries[0].params, [TENANT, 'u-1', 20]);
  assert.match(queries[0].sql, /tenant_id = \$1 AND usuario_id = \$2/);
  assert.match(queries[0].sql, /ORDER BY enviado_at DESC/);
});
