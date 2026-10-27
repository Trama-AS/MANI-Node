const test = require('node:test');
const assert = require('node:assert/strict');
const PgServiceRequestRepository = require('../../../src/infrastructure/repositories/PgServiceRequestRepository');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const ctx = { tenantId: TENANT, userId: USER, role: 'CLIENT' };
const datosBase = {
  categoriaId: 'cat', descripcion: 'Fuga de agua en el baño principal', sitioId: null, direccion: 'Calle 1', zonaId: 'zona', fotos: ['t/u/a.png'], claveIdempotencia: null,
};
const filaProyeccion = {
  id: 'sol-1', estado: 'PENDIENTE', categoria_id: 'cat', categoria: 'Plomería', flujo_operativo: 'COTIZACION_PREVIA', descripcion: 'd',
  sitio_id: 'sitio-1', direccion: 'Calle 1', zona_id: 'zona', zona: 'Chapinero', zona_padre: 'Bogotá', fotos: 1, created_at: new Date('2026-10-19T00:00:00Z'),
};

// Pool simulado de `pg`: responde según la sentencia y registra el orden de la transacción.
function fakeFactory(respuestas = {}) {
  const sentencias = [];
  const responder = (sql) => {
    for (const [clave, valor] of Object.entries(respuestas)) {
      if (sql.includes(clave)) return typeof valor === 'function' ? valor(sql) : valor;
    }
    return { rows: [] };
  };
  const client = {
    query: async (sql, params) => {
      sentencias.push({ sql: sql.trim(), params });
      return responder(sql);
    },
    release: () => {},
  };
  return { factory: { getPool: () => ({ connect: async () => client }) }, sentencias };
}

const exito = () => ({
  'FROM cliente c JOIN usuario u': { rows: [{ id: 'cliente-1' }] },
  'FROM categoria_servicio WHERE id': { rows: [{}] },
  'FROM zona WHERE id': { rows: [{}] },
  'INSERT INTO sitio': { rows: [{ id: 'sitio-1' }] },
  'INSERT INTO solicitud (': { rows: [{ id: 'sol-1' }] },
  'FROM solicitud s': { rows: [filaProyeccion] },
});

test('crea sitio, solicitud PENDIENTE, fotos y evento en una transacción con el contexto del tenant', async () => {
  const { factory, sentencias } = fakeFactory(exito());

  const r = await new PgServiceRequestRepository({ pgPoolFactory: factory }).crear(ctx, datosBase);

  assert.equal(r.creada, true);
  assert.equal(r.solicitud.id, 'sol-1');
  assert.equal(r.solicitud.flujoOperativo, 'COTIZACION_PREVIA');
  const orden = sentencias.map((s) => s.sql.split(/\s+/).slice(0, 3).join(' '));
  assert.equal(orden[0], 'BEGIN');
  assert.match(sentencias[1].sql, /^SELECT app\.set_context/);
  assert.deepEqual(sentencias[1].params, [TENANT, USER, 'cliente']);
  const insercion = sentencias.find((s) => s.sql.startsWith('INSERT INTO solicitud ('));
  assert.match(insercion.sql, /'PENDIENTE'/);
  assert.deepEqual(insercion.params, [TENANT, 'cliente-1', 'sitio-1', 'cat', 'zona', datosBase.descripcion, null]);
  const foto = sentencias.find((s) => s.sql.startsWith('INSERT INTO solicitud_foto'));
  assert.deepEqual(foto.params, [TENANT, 'sol-1', 't/u/a.png', 1]);
  const evento = sentencias.find((s) => s.sql.startsWith('INSERT INTO evento_servicio'));
  assert.match(evento.sql, /'SOLICITUD_CREADA'/);
  assert.equal(sentencias.at(-1).sql, 'COMMIT');
});

test('con sitio propio usa su zona y no crea sitio', async () => {
  const resp = { ...exito(), 'FROM sitio WHERE id': { rows: [{ id: 'sitio-9', zona_id: 'zona-9' }] } };
  const { factory, sentencias } = fakeFactory(resp);

  await new PgServiceRequestRepository({ pgPoolFactory: factory }).crear(ctx, { ...datosBase, sitioId: 'sitio-9', direccion: null, zonaId: null });

  assert.ok(!sentencias.some((s) => s.sql.startsWith('INSERT INTO sitio')));
  const insercion = sentencias.find((s) => s.sql.startsWith('INSERT INTO solicitud ('));
  assert.equal(insercion.params[2], 'sitio-9');
  assert.equal(insercion.params[4], 'zona-9');
});

test('la misma clave de idempotencia devuelve la solicitud existente sin insertar (creada=false)', async () => {
  const resp = { ...exito(), 'clave_idempotencia = $2': { rows: [{ id: 'sol-previa' }] } };
  const { factory, sentencias } = fakeFactory(resp);

  const r = await new PgServiceRequestRepository({ pgPoolFactory: factory }).crear(ctx, { ...datosBase, claveIdempotencia: 'k' });

  assert.equal(r.creada, false);
  assert.ok(!sentencias.some((s) => s.sql.startsWith('INSERT')));
});

test('carrera de idempotencia: un unique_violation vuelve al savepoint y devuelve la ganadora', async () => {
  let consultasClave = 0;
  const resp = {
    ...exito(),
    'clave_idempotencia = $2': () => { consultasClave += 1; return { rows: consultasClave === 1 ? [] : [{ id: 'sol-ganadora' }] }; },
    'INSERT INTO solicitud (': () => { const e = new Error('duplicate key'); e.code = '23505'; throw e; },
  };
  const { factory, sentencias } = fakeFactory(resp);

  const r = await new PgServiceRequestRepository({ pgPoolFactory: factory }).crear(ctx, { ...datosBase, claveIdempotencia: 'k' });

  assert.equal(r.creada, false);
  assert.ok(sentencias.some((s) => s.sql === 'ROLLBACK TO SAVEPOINT crear_solicitud'));
  assert.equal(sentencias.at(-1).sql, 'COMMIT');
});

for (const [name, quitar, codigo, status] of [
  ['cliente inactivo o inexistente', 'FROM cliente c JOIN usuario u', 'MANI-SOL-403C', 403],
  ['categoría no disponible', 'FROM categoria_servicio WHERE id', 'MANI-SOL-422C', 422],
  ['zona no disponible', 'FROM zona WHERE id', 'MANI-SOL-422Z', 422],
]) {
  test(`${name} responde ${status} ${codigo} y revierte`, async () => {
    const resp = exito();
    delete resp[quitar];
    const { factory, sentencias } = fakeFactory(resp);

    await assert.rejects(() => new PgServiceRequestRepository({ pgPoolFactory: factory }).crear(ctx, datosBase), (e) => e.statusCode === status && e.code === codigo);
    assert.equal(sentencias.at(-1).sql, 'ROLLBACK');
    assert.ok(!sentencias.some((s) => s.sql.startsWith('INSERT')));
  });
}

test('la categoría solo se acepta si está ACTIVO y es del tenant: una desactivada rechaza la solicitud nueva (SCRUM-858 C2 / SCRUM-1391)', async () => {
  const { factory, sentencias } = fakeFactory(exito());

  await new PgServiceRequestRepository({ pgPoolFactory: factory }).crear(ctx, datosBase);

  const consulta = sentencias.find((s) => s.sql.includes('FROM categoria_servicio WHERE id'));
  assert.match(consulta.sql, /tenant_id = \$2 AND estado = 'ACTIVO'/);
  assert.deepEqual(consulta.params, ['cat', TENANT]);
});

test('un sitio que no es del cliente responde 422 MANI-SOL-422S', async () => {
  const { factory } = fakeFactory(exito());

  await assert.rejects(
    () => new PgServiceRequestRepository({ pgPoolFactory: factory }).crear(ctx, { ...datosBase, sitioId: 'ajeno' }),
    (e) => e.code === 'MANI-SOL-422S'
  );
});

test('otros errores de la base se propagan y revierten', async () => {
  const resp = { ...exito(), 'INSERT INTO solicitud (': () => { throw new Error('caída'); } };
  const { factory, sentencias } = fakeFactory(resp);

  await assert.rejects(() => new PgServiceRequestRepository({ pgPoolFactory: factory }).crear(ctx, datosBase), /caída/);
  assert.equal(sentencias.at(-1).sql, 'ROLLBACK');
});

test('sin DATABASE_URL falla cerrado con 503 y exige pgPoolFactory', async () => {
  await assert.rejects(() => new PgServiceRequestRepository({ pgPoolFactory: { getPool: () => null } }).crear(ctx, datosBase), (e) => e.statusCode === 503);
  assert.throws(() => new PgServiceRequestRepository({}), /pgPoolFactory/);
});

// HU-M07-04 (SCRUM-871): seguimiento del cliente.
const filaSeguimiento = {
  id: 'sol-1', estado: 'ASIGNADA', categoria: 'Plomería', zona: 'Chapinero', zona_nivel: 'LOCALIDAD', zona_padre: 'Bogotá',
  created_at: new Date('2026-10-19T00:00:00Z'), updated_at: new Date('2026-10-20T00:00:00Z'),
};

test('SCRUM-871: lista solo las solicitudes del usuario del token en su tenant, dentro del contexto de tenant', async () => {
  const { factory, sentencias } = fakeFactory({ 'JOIN cliente cl': { rows: [filaSeguimiento] } });

  const r = await new PgServiceRequestRepository({ pgPoolFactory: factory }).listarDelCliente(ctx);

  const consulta = sentencias.find((s) => s.sql.includes('JOIN cliente cl'));
  assert.match(consulta.sql, /WHERE cl\.usuario_id = \$1 AND s\.tenant_id = \$2/);
  assert.match(consulta.sql, /cl\.tenant_id = s\.tenant_id/);
  assert.match(consulta.sql, /ORDER BY s\.updated_at DESC, s\.id LIMIT 50/);
  assert.deepEqual(consulta.params, [USER, TENANT]);
  assert.equal(sentencias.at(-1).sql, 'COMMIT');
  assert.deepEqual(r, [{
    id: 'sol-1',
    estado: 'ASIGNADA',
    categoria: 'Plomería',
    zonaDeclarada: { nombre: 'Chapinero', nivel: 'LOCALIDAD', zonaPadre: 'Bogotá' },
    creadaEn: filaSeguimiento.created_at,
    actualizadaEn: filaSeguimiento.updated_at,
  }]);
});

test('SCRUM-871: obtiene una solicitud filtrando por id, usuario y tenant; ajena o inexistente da null', async () => {
  const conFila = fakeFactory({ 'JOIN cliente cl': { rows: [filaSeguimiento] } });
  const r = await new PgServiceRequestRepository({ pgPoolFactory: conFila.factory }).obtenerDelCliente(ctx, 'sol-1');

  const consulta = conFila.sentencias.find((s) => s.sql.includes('JOIN cliente cl'));
  assert.match(consulta.sql, /AND s\.id = \$3$/);
  assert.deepEqual(consulta.params, [USER, TENANT, 'sol-1']);
  assert.equal(r.zonaDeclarada.nombre, 'Chapinero');

  const vacia = fakeFactory({ 'JOIN cliente cl': { rows: [] } });
  assert.equal(await new PgServiceRequestRepository({ pgPoolFactory: vacia.factory }).obtenerDelCliente(ctx, 'otra'), null);
});

test('SCRUM-871: el seguimiento sin DATABASE_URL falla cerrado con 503', async () => {
  const repo = new PgServiceRequestRepository({ pgPoolFactory: { getPool: () => null } });
  await assert.rejects(() => repo.listarDelCliente(ctx), (e) => e.statusCode === 503);
  await assert.rejects(() => repo.obtenerDelCliente(ctx, 'sol-1'), (e) => e.statusCode === 503);
});

// US-04.5.1 (SCRUM-877): cancelación antes de la ejecución.
const SOL_CANCELAR = 'sol-1';
const cancelacion = (estado, aliadoId = null) => ({
  'FOR UPDATE OF s': { rows: [{ estado, aliado_id: aliadoId }] },
  'JOIN cliente cl': { rows: [{ ...filaSeguimiento, estado: 'CANCELADA' }] },
});

test('SCRUM-877: cancela una PENDIENTE bloqueando la fila del cliente y deja el evento con el motivo, sin notificar', async () => {
  const { factory, sentencias } = fakeFactory(cancelacion('PENDIENTE'));

  const r = await new PgServiceRequestRepository({ pgPoolFactory: factory }).cancelar(ctx, { solicitudId: SOL_CANCELAR, motivo: 'Ya no lo necesito' });

  assert.equal(r.cancelada, true);
  assert.equal(r.solicitud.estado, 'CANCELADA');
  const bloqueo = sentencias.find((s) => s.sql.includes('FOR UPDATE OF s'));
  assert.match(bloqueo.sql, /WHERE cl\.usuario_id = \$1 AND s\.tenant_id = \$2 AND s\.id = \$3/);
  assert.deepEqual(bloqueo.params, [USER, TENANT, SOL_CANCELAR]);
  const cambio = sentencias.find((s) => s.sql.startsWith('UPDATE solicitud'));
  assert.match(cambio.sql, /estado = 'CANCELADA'/);
  assert.deepEqual(cambio.params, [SOL_CANCELAR, TENANT]);
  const evento = sentencias.find((s) => s.sql.startsWith('INSERT INTO evento_servicio'));
  assert.match(evento.sql, /'SOLICITUD_CANCELADA'/);
  assert.deepEqual(evento.params, [TENANT, SOL_CANCELAR, USER, 'Ya no lo necesito']);
  assert.ok(!sentencias.some((s) => s.sql.startsWith('INSERT INTO notificacion')));
  assert.equal(sentencias.at(-1).sql, 'COMMIT');
});

test('SCRUM-877: con aliado asignado le deja la notificación SOLICITUD_CANCELADA en su bandeja', async () => {
  const { factory, sentencias } = fakeFactory(cancelacion('ASIGNADA', 'aliado-1'));

  await new PgServiceRequestRepository({ pgPoolFactory: factory }).cancelar(ctx, { solicitudId: SOL_CANCELAR, motivo: null });

  const evento = sentencias.find((s) => s.sql.startsWith('INSERT INTO evento_servicio'));
  assert.equal(evento.params[3], 'El cliente canceló la solicitud.');
  const aviso = sentencias.find((s) => s.sql.startsWith('INSERT INTO notificacion'));
  assert.match(aviso.sql, /'SOLICITUD_CANCELADA', 'IN_APP'/);
  assert.match(aviso.sql, /a\.tenant_id = \$1/);
  assert.deepEqual(aviso.params, [TENANT, 'aliado-1', JSON.stringify({ requestId: SOL_CANCELAR })]);
});

test('SCRUM-877: se cancela desde cualquier estado anterior a la ejecución', async () => {
  for (const estado of ['PENDIENTE', 'ASIGNADA', 'COTIZANDO', 'ACEPTADA', 'RECHAZADA']) {
    const { factory } = fakeFactory(cancelacion(estado));
    const r = await new PgServiceRequestRepository({ pgPoolFactory: factory }).cancelar(ctx, { solicitudId: SOL_CANCELAR });
    assert.equal(r.cancelada, true, estado);
  }
});

test('SCRUM-877: en ejecución o cerrada responde 409 MANI-SOL-409C y revierte sin escribir', async () => {
  for (const estado of ['EN_EJECUCION', 'FINALIZADA']) {
    const { factory, sentencias } = fakeFactory(cancelacion(estado));
    await assert.rejects(
      () => new PgServiceRequestRepository({ pgPoolFactory: factory }).cancelar(ctx, { solicitudId: SOL_CANCELAR }),
      (e) => e.statusCode === 409 && e.code === 'MANI-SOL-409C'
    );
    assert.ok(!sentencias.some((s) => /^(UPDATE|INSERT)/.test(s.sql)));
    assert.equal(sentencias.at(-1).sql, 'ROLLBACK');
  }
});

test('SCRUM-877: cancelar otra vez es idempotente: devuelve la solicitud sin repetir evento ni aviso', async () => {
  const { factory, sentencias } = fakeFactory(cancelacion('CANCELADA', 'aliado-1'));

  const r = await new PgServiceRequestRepository({ pgPoolFactory: factory }).cancelar(ctx, { solicitudId: SOL_CANCELAR });

  assert.equal(r.cancelada, false);
  assert.equal(r.solicitud.estado, 'CANCELADA');
  assert.ok(!sentencias.some((s) => /^(UPDATE|INSERT)/.test(s.sql)));
  assert.equal(sentencias.at(-1).sql, 'COMMIT');
});

test('SCRUM-877: una solicitud ajena, de otro tenant o inexistente responde 404 MANI-SOL-404', async () => {
  const { factory, sentencias } = fakeFactory({ 'FOR UPDATE OF s': { rows: [] } });

  await assert.rejects(
    () => new PgServiceRequestRepository({ pgPoolFactory: factory }).cancelar(ctx, { solicitudId: 'ajena' }),
    (e) => e.statusCode === 404 && e.code === 'MANI-SOL-404'
  );
  assert.ok(!sentencias.some((s) => /^(UPDATE|INSERT)/.test(s.sql)));
});

test('SCRUM-877: la cancelación sin DATABASE_URL falla cerrado con 503', async () => {
  const repo = new PgServiceRequestRepository({ pgPoolFactory: { getPool: () => null } });
  await assert.rejects(() => repo.cancelar(ctx, { solicitudId: SOL_CANCELAR }), (e) => e.statusCode === 503);
});
