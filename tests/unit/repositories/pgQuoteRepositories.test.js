const test = require('node:test');
const assert = require('node:assert/strict');
const PgCotizacionRepository = require('../../../src/infrastructure/repositories/PgCotizacionRepository');
const PgSolicitudRepository = require('../../../src/infrastructure/repositories/PgSolicitudRepository');
const PgEventoServicioRepository = require('../../../src/infrastructure/repositories/PgEventoServicioRepository');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SOL = '33333333-3333-4333-8333-333333333333';

// Pool simulado de `pg`: registra cada sentencia de la transacción que abre withTenantContext.
function fakeFactory(answer = () => ({ rows: [] })) {
  const queries = [];
  const client = {
    query: async (sql, params) => {
      queries.push({ sql, params });
      if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql) || sql.startsWith('SELECT app.set_context')) return { rows: [] };
      return answer(sql, params);
    },
    release: () => {},
  };
  return { factory: { getPool: () => ({ connect: async () => client }) }, queries };
}

const ctx = { tenantId: TENANT, userId: USER, role: 'ALLY' };
const cotRow = {
  id: 'c1', tenant_id: TENANT, solicitud_id: SOL, aliado_id: 'a1', valor_mano_obra: '65000.00', valor_materiales: '15000.00',
  estado: 'PENDIENTE', version: 1, observacion: null, created_at: new Date('2026-10-18T10:00:00Z'),
};

test('cada operación abre transacción con set_context(tenant, usuario, rol del claim) antes de tocar datos', async () => {
  const { factory, queries } = fakeFactory(() => ({ rows: [cotRow] }));

  await new PgCotizacionRepository({ pgPoolFactory: factory }).findById(ctx, 'c1');

  assert.equal(queries[0].sql, 'BEGIN');
  assert.equal(queries[1].sql, 'SELECT app.set_context($1, $2, $3)');
  assert.deepEqual(queries[1].params, [TENANT, USER, 'aliado']);
  assert.equal(queries.at(-1).sql, 'COMMIT');
});

test('un userId que no es UUID viaja como null en el contexto', async () => {
  const { factory, queries } = fakeFactory(() => ({ rows: [] }));

  await new PgCotizacionRepository({ pgPoolFactory: factory }).findById({ ...ctx, userId: 'demo-user' }, 'c1');

  assert.deepEqual(queries[1].params, [TENANT, null, 'aliado']);
});

test('cotizacion.create inserta en las columnas reales con tenant_id y mapea la fila', async () => {
  const { factory, queries } = fakeFactory(() => ({ rows: [cotRow] }));

  const created = await new PgCotizacionRepository({ pgPoolFactory: factory }).create(ctx, {
    solicitudId: SOL, aliadoId: 'a1', valorManoObra: 65000, valorMateriales: 15000, estado: 'PENDIENTE', version: 1, observacion: null,
  });

  const insert = queries.find((q) => q.sql.includes('INSERT INTO cotizacion'));
  assert.match(insert.sql, /tenant_id, solicitud_id, aliado_id, valor_mano_obra, valor_materiales, estado, version, observacion/);
  assert.deepEqual(insert.params, [TENANT, SOL, 'a1', 65000, 15000, 'PENDIENTE', 1, null]);
  assert.equal(created.valor, 80000);
  assert.equal(created.aliadoId, 'a1');
});

test('cotizacion: lecturas y actualización filtran por tenant y no usan interpolación', async () => {
  const { factory, queries } = fakeFactory(() => ({ rows: [cotRow] }));
  const repo = new PgCotizacionRepository({ pgPoolFactory: factory });

  await repo.findById(ctx, 'c1');
  await repo.findBySolicitudId(ctx, SOL);
  await repo.updateEstado(ctx, 'c1', 'ACEPTADA');

  const datos = queries.filter((q) => /cotizacion/.test(q.sql));
  assert.equal(datos.length, 3);
  for (const q of datos) {
    assert.match(q.sql, /tenant_id = \$\d/);
    assert.ok(q.params.includes(TENANT));
    assert.doesNotMatch(q.sql, /\$\{|\.or\(/);
  }
});

test('cotizacion y evento: insertar sobre una solicitud que no es del tenant responde 404 sin escribir', async () => {
  const { factory, queries } = fakeFactory(() => ({ rows: [] }));

  await assert.rejects(
    () => new PgCotizacionRepository({ pgPoolFactory: factory }).create(ctx, {
      solicitudId: SOL, aliadoId: 'a1', valorManoObra: 1, valorMateriales: 0, estado: 'PENDIENTE', version: 1, observacion: null,
    }),
    (e) => e.statusCode === 404
  );
  await assert.rejects(
    () => new PgEventoServicioRepository({ pgPoolFactory: factory }).create(ctx, { solicitudId: SOL, actorId: USER, tipoEvento: 'X' }),
    (e) => e.statusCode === 404
  );
  for (const q of queries.filter((x) => x.sql.includes('INSERT'))) {
    assert.match(q.sql, /WHERE EXISTS \(SELECT 1 FROM solicitud s WHERE s\.id = \$2 AND s\.tenant_id = \$1\)/);
  }
  assert.equal(queries.at(-1).sql, 'ROLLBACK');
});

test('cotizacion: sin filas devuelve null', async () => {
  const { factory } = fakeFactory(() => ({ rows: [] }));
  const repo = new PgCotizacionRepository({ pgPoolFactory: factory });

  assert.equal(await repo.findById(ctx, 'x'), null);
  assert.equal(await repo.updateEstado(ctx, 'x', 'ACEPTADA'), null);
});

test('solicitud: findById, findByClienteId y updateEstado sobre columnas reales y filtradas por tenant', async () => {
  const row = {
    id: SOL, tenant_id: TENANT, cliente_id: 'cl1', sitio_id: null, categoria_id: 'cat', zona_id: 'z', aliado_id: 'a1',
    descripcion: 'd', estado: 'ASIGNADA', created_at: new Date(), updated_at: null,
  };
  const { factory, queries } = fakeFactory(() => ({ rows: [row] }));
  const repo = new PgSolicitudRepository({ pgPoolFactory: factory });

  const sol = await repo.findById(ctx, SOL);
  const lista = await repo.findByClienteId(ctx, 'cl1', { estado: 'ASIGNADA' });
  await repo.updateEstado(ctx, SOL, 'COTIZANDO');

  assert.equal(sol.aliadoId, 'a1');
  assert.equal(lista.length, 1);
  const datos = queries.filter((q) => /solicitud/.test(q.sql));
  assert.deepEqual(datos[1].params, [TENANT, 'cl1', 'ASIGNADA']);
  assert.match(datos[2].sql, /UPDATE solicitud SET estado = \$1, updated_at = now\(\) WHERE id = \$2 AND tenant_id = \$3/);
  for (const q of datos) assert.doesNotMatch(q.sql, /fecha_inicio_ejecucion|direccion|historial_solicitud/);
});

test('solicitud: sin filas devuelve null', async () => {
  const { factory } = fakeFactory(() => ({ rows: [] }));
  const repo = new PgSolicitudRepository({ pgPoolFactory: factory });

  assert.equal(await repo.findById(ctx, SOL), null);
  assert.equal(await repo.updateEstado(ctx, SOL, 'X'), null);
});

test('evento_servicio: inserta con tenant_id y actor, y lista por solicitud en orden cronológico', async () => {
  const row = { id: 'e1', tenant_id: TENANT, solicitud_id: SOL, actor_id: USER, tipo_evento: 'COTIZACION_ENVIADA', descripcion: 'x', timestamp: new Date() };
  const { factory, queries } = fakeFactory(() => ({ rows: [row] }));
  const repo = new PgEventoServicioRepository({ pgPoolFactory: factory });

  const creado = await repo.create(ctx, { solicitudId: SOL, actorId: USER, tipoEvento: 'COTIZACION_ENVIADA', descripcion: 'x' });
  const lista = await repo.findBySolicitudId(ctx, SOL);

  assert.equal(creado.tipoEvento, 'COTIZACION_ENVIADA');
  assert.equal(lista.length, 1);
  const insert = queries.find((q) => q.sql.includes('INSERT INTO evento_servicio'));
  assert.deepEqual(insert.params, [TENANT, SOL, USER, 'COTIZACION_ENVIADA', 'x']);
  const select = queries.find((q) => q.sql.startsWith('SELECT') && q.sql.includes('evento_servicio'));
  assert.match(select.sql, /ORDER BY "timestamp"/);
});

test('un error de la base revierte la transacción y se propaga', async () => {
  const { factory, queries } = fakeFactory(() => {
    throw new Error('violación de RLS');
  });

  await assert.rejects(() => new PgCotizacionRepository({ pgPoolFactory: factory }).findById(ctx, 'c1'), /violación de RLS/);
  assert.equal(queries.at(-1).sql, 'ROLLBACK');
});

test('sin DATABASE_URL fallan cerrado con 503', async () => {
  const factory = { getPool: () => null };

  await assert.rejects(() => new PgCotizacionRepository({ pgPoolFactory: factory }).findById(ctx, 'c1'), (e) => e.statusCode === 503);
  await assert.rejects(() => new PgSolicitudRepository({ pgPoolFactory: factory }).findById(ctx, SOL), (e) => e.statusCode === 503);
  await assert.rejects(() => new PgEventoServicioRepository({ pgPoolFactory: factory }).findBySolicitudId(ctx, SOL), (e) => e.statusCode === 503);
});

test('exigen pgPoolFactory', () => {
  assert.throws(() => new PgCotizacionRepository({}), /pgPoolFactory/);
  assert.throws(() => new PgSolicitudRepository({}), /pgPoolFactory/);
  assert.throws(() => new PgEventoServicioRepository({}), /pgPoolFactory/);
});
