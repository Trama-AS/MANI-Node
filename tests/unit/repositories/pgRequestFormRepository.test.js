const test = require('node:test');
const assert = require('node:assert/strict');
const PgRequestFormRepository = require('../../../src/infrastructure/repositories/PgRequestFormRepository');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const ctx = { tenantId: TENANT, userId: USER, role: 'CLIENT' };

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

const conCliente = (extra = {}) => ({ 'FROM cliente c JOIN usuario u': { rows: [{ id: 'cliente-1' }] }, ...extra });

test('categorías: solo ACTIVO del tenant del token, por nombre, con el contexto fijado', async () => {
  const { factory, sentencias } = fakeFactory(
    conCliente({ 'FROM categoria_servicio': { rows: [{ id: 'c1', nombre: 'Plomería', flujo_operativo: 'COTIZACION_PREVIA' }] } })
  );

  const r = await new PgRequestFormRepository({ pgPoolFactory: factory }).listarCategorias(ctx);

  assert.deepEqual(r, [{ id: 'c1', nombre: 'Plomería', flujoOperativo: 'COTIZACION_PREVIA' }]);
  assert.equal(sentencias[0].sql, 'BEGIN');
  assert.deepEqual(sentencias[1].params, [TENANT, USER, 'cliente']);
  const lectura = sentencias.find((s) => s.sql.includes('FROM categoria_servicio'));
  assert.match(lectura.sql, /tenant_id = \$1 AND estado = 'ACTIVO'/);
  assert.match(lectura.sql, /ORDER BY lower\(nombre\)/);
  assert.deepEqual(lectura.params, [TENANT]);
  assert.equal(sentencias.at(-1).sql, 'COMMIT');
});

test('sitios: los del cliente de la sesión con zona y zona padre; sin nombre se usa la dirección', async () => {
  const filas = [
    { id: 's1', nombre: 'Sede Norte', direccion: 'Calle 100 # 10-20', zona_id: 'z1', zona: 'Usaquén', zona_padre: 'Bogotá' },
    { id: 's2', nombre: null, direccion: 'Carrera 7 # 45-10', zona_id: 'z2', zona: 'Chapinero', zona_padre: null },
  ];
  const { factory, sentencias } = fakeFactory(conCliente({ 'FROM sitio s': { rows: filas } }));

  const r = await new PgRequestFormRepository({ pgPoolFactory: factory }).listarSitios(ctx);

  assert.deepEqual(r, [
    { id: 's1', nombre: 'Sede Norte', direccion: 'Calle 100 # 10-20', zonaId: 'z1', zona: 'Usaquén', zonaPadre: 'Bogotá' },
    { id: 's2', nombre: 'Carrera 7 # 45-10', direccion: 'Carrera 7 # 45-10', zonaId: 'z2', zona: 'Chapinero', zonaPadre: null },
  ]);
  const lectura = sentencias.find((s) => s.sql.includes('FROM sitio s'));
  assert.deepEqual(lectura.params, ['cliente-1', TENANT]);
  assert.match(lectura.sql, /LEFT JOIN zona zp ON zp\.id = z\.zona_padre_id/);
});

test('sin cliente activo en el tenant → 403 MANI-SOL-403C, ROLLBACK y sin leer datos', async () => {
  for (const metodo of ['listarCategorias', 'listarSitios']) {
    const { factory, sentencias } = fakeFactory();
    await assert.rejects(new PgRequestFormRepository({ pgPoolFactory: factory })[metodo](ctx), {
      statusCode: 403,
      code: 'MANI-SOL-403C',
    });
    assert.equal(sentencias.at(-1).sql, 'ROLLBACK');
    assert.ok(!sentencias.some((s) => s.sql.includes('FROM categoria_servicio') || s.sql.includes('FROM sitio s')));
  }
});

test('sin DATABASE_URL responde 503 y exige pgPoolFactory', async () => {
  await assert.rejects(new PgRequestFormRepository({ pgPoolFactory: { getPool: () => null } }).listarSitios(ctx), {
    statusCode: 503,
  });
  assert.throws(() => new PgRequestFormRepository({}), /pgPoolFactory es requerido/);
});
