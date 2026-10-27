const test = require('node:test');
const assert = require('node:assert/strict');

const PgElegibilidadRepository = require('../../../src/infrastructure/repositories/PgElegibilidadRepository');
const PgSolicitudContextRepository = require('../../../src/infrastructure/repositories/PgSolicitudContextRepository');
const PgNotificacionRepository = require('../../../src/infrastructure/repositories/PgNotificacionRepository');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const CATEGORIA = '33333333-3333-4333-8333-333333333333';
const ZONA = '44444444-4444-4444-8444-444444444444';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';
const ALLY = '66666666-6666-4666-8666-666666666666';
const ALLY_2 = '77777777-7777-4777-8777-777777777777';

const ctxCliente = { tenantId: TENANT, userId: USER, role: 'CLIENT' };
const ctxAliado = { tenantId: TENANT, userId: USER, role: 'ALLY' };

// Pool transaccional simulado: registra cada sentencia del cliente (BEGIN, app.set_context, la consulta y COMMIT)
// y responde la consulta de negocio con lo que entrega `answer`.
function fakeFactory(answer) {
  const sentencias = [];
  const client = {
    query: async (sql, params) => {
      sentencias.push({ sql: sql.trim(), params });
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql.trim()) || sql.includes('app.set_context')) return { rows: [] };
      return answer(sql, params);
    },
    release: () => {},
  };
  const negocio = () => sentencias.filter((s) => !/^(BEGIN|COMMIT|ROLLBACK)/.test(s.sql) && !s.sql.includes('app.set_context'));
  return { factory: { getPool: () => ({ connect: async () => client }) }, sentencias, negocio };
}

function contextoFijado(sentencias) {
  assert.equal(sentencias[0].sql, 'BEGIN');
  assert.match(sentencias[1].sql, /^SELECT app\.set_context/);
  return sentencias[1].params;
}

test('elegibilidad: corre con el contexto del tenant, una sola consulta, y mapea las filas', async () => {
  const { factory, sentencias, negocio } = fakeFactory(() => ({
    rows: [{
      total: 3,
      allies: [{ id: ALLY, nombre_razon_social: 'Ana', tipo: 'PERSONA_NATURAL', estado_verificacion: 'VERIFICADO' }],
    }],
  }));
  const repo = new PgElegibilidadRepository({ pgPoolFactory: factory });

  const result = await repo.findEligible(ctxCliente, {
    categoriaId: CATEGORIA, zonaId: ZONA, excludeAllyIds: [ALLY_2], tipo: 'PERSONA_NATURAL', page: 3, pageSize: 10,
  });

  assert.deepEqual(result, {
    allies: [{ id: ALLY, nombreRazonSocial: 'Ana', tipo: 'PERSONA_NATURAL', estadoVerificacion: 'VERIFICADO' }],
    totalCount: 3,
  });
  assert.deepEqual(contextoFijado(sentencias), [TENANT, USER, 'cliente']);
  assert.equal(negocio().length, 1);
  const { sql, params } = negocio()[0];
  assert.deepEqual(params, [TENANT, CATEGORIA, ZONA, 'PERSONA_NATURAL', [ALLY_2], 20, 10]);
  assert.match(sql, /a\.tenant_id = \$1/);
  assert.match(sql, /estado_verificacion = 'VERIFICADO'/);
  assert.match(sql, /u\.estado = 'ACTIVO'/, 'excluye aliados con la cuenta inactiva');
  assert.match(sql, /cs\.estado = 'ACTIVO'/, 'excluye categorías inactivas');
  assert.match(sql, /NOT \(a\.id = ANY\(\$5::uuid\[\]\)\)/);
  assert.match(sql, /aa\.inicio <= now\(\) AND aa\.fin > now\(\)/);
  assert.doesNotMatch(sql, /solicitud_rechazo/, 'Core no lee tablas del dominio de Dispatch (T1)');
});

test('elegibilidad: sin tipo ni exclusiones envía null y una lista vacía', async () => {
  const { factory, negocio } = fakeFactory(() => ({ rows: [{ total: 0, allies: [] }] }));
  const repo = new PgElegibilidadRepository({ pgPoolFactory: factory });

  const result = await repo.findEligible(ctxCliente, { categoriaId: CATEGORIA, zonaId: ZONA, page: 1, pageSize: 20 });

  assert.deepEqual(result, { allies: [], totalCount: 0 });
  assert.deepEqual(negocio()[0].params, [TENANT, CATEGORIA, ZONA, null, [], 0, 20]);
});

test('elegibilidad: un error de la base revierte la transacción y se propaga', async () => {
  const { factory, sentencias } = fakeFactory(() => {
    throw new Error('conexión perdida');
  });
  const repo = new PgElegibilidadRepository({ pgPoolFactory: factory });

  await assert.rejects(
    () => repo.findEligible(ctxCliente, { categoriaId: CATEGORIA, zonaId: ZONA, page: 1, pageSize: 20 }),
    /conexión perdida/
  );
  assert.equal(sentencias.at(-1).sql, 'ROLLBACK');
});

test('repositorios: exigen pgPoolFactory', () => {
  assert.throws(() => new PgElegibilidadRepository({}), /pgPoolFactory/);
  assert.throws(() => new PgSolicitudContextRepository({}), /pgPoolFactory/);
  assert.throws(() => new PgNotificacionRepository({}), /pgPoolFactory/);
});

test('contexto: filtra por id, tenant, rol y usuario de la sesión y mapea la fila', async () => {
  const { factory, sentencias, negocio } = fakeFactory(() => ({
    rows: [{ id: SOLICITUD, tenant_id: TENANT, zona_id: ZONA, categoria_id: CATEGORIA, estado: 'PENDIENTE', es_mia: false }],
  }));
  const repo = new PgSolicitudContextRepository({ pgPoolFactory: factory });

  const context = await repo.findContext(ctxAliado, SOLICITUD);

  assert.deepEqual(context, {
    id: SOLICITUD, tenantId: TENANT, zonaId: ZONA, categoriaId: CATEGORIA, estado: 'PENDIENTE', esMia: false,
  });
  assert.deepEqual(contextoFijado(sentencias), [TENANT, USER, 'aliado']);
  const { sql, params } = negocio()[0];
  assert.deepEqual(params, [SOLICITUD, TENANT, 'ALLY', USER]);
  assert.match(sql, /s\.tenant_id = \$2/);
  assert.match(sql, /\$3 = 'CLIENT' AND c\.usuario_id = \$4/, 'el cliente solo ve las suyas');
  assert.match(sql, /tipo = 'OFERTA_DESPACHO'/, 'el aliado ve las que le ofrecieron');
});

test('contexto: sin filas devuelve null', async () => {
  const { factory } = fakeFactory(() => ({ rows: [] }));

  assert.equal(await new PgSolicitudContextRepository({ pgPoolFactory: factory }).findContext(ctxCliente, SOLICITUD), null);
});

test('notificaciones: inserta para el usuario del aliado del mismo tenant y devuelve el id', async () => {
  const { factory, sentencias, negocio } = fakeFactory(() => ({ rows: [{ id: 'n-1', usuario_id: 'u-1' }] }));
  const repo = new PgNotificacionRepository({ pgPoolFactory: factory });
  const payload = { requestId: SOLICITUD, estado: 'ENVIADA' };

  const created = await repo.createForAlly(ctxCliente, { allyId: ALLY, tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload });

  assert.deepEqual(created, { id: 'n-1', usuarioId: 'u-1', nueva: true });
  assert.deepEqual(contextoFijado(sentencias), [TENANT, USER, 'cliente']);
  assert.deepEqual(negocio()[0].params, [TENANT, ALLY, 'OFERTA_DESPACHO', 'PUSH', JSON.stringify(payload)]);
  assert.match(negocio()[0].sql, /a\.tenant_id = \$1/);
  assert.match(negocio()[0].sql, /ON CONFLICT \(tenant_id, usuario_id, \(payload->>'requestId'\)\) WHERE tipo = 'OFERTA_DESPACHO' DO NOTHING/);
  assert.equal(negocio().length, 1, 'si inserta no busca la existente');
});

test('notificaciones: una oferta repetida no se inserta y devuelve la existente con nueva=false', async () => {
  let llamada = 0;
  const { factory, negocio } = fakeFactory(() => {
    llamada += 1;
    return { rows: llamada === 1 ? [] : [{ id: 'n-previa', usuario_id: 'u-1' }] };
  });
  const repo = new PgNotificacionRepository({ pgPoolFactory: factory });

  const created = await repo.createForAlly(ctxCliente, { allyId: ALLY, tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload: { requestId: SOLICITUD } });

  assert.deepEqual(created, { id: 'n-previa', usuarioId: 'u-1', nueva: false });
  assert.equal(negocio().length, 2, 'la existente se busca en una segunda sentencia');
  assert.deepEqual(negocio()[1].params, [TENANT, ALLY, 'OFERTA_DESPACHO', JSON.stringify({ requestId: SOLICITUD })]);
});

test('notificaciones: un aliado que no es del tenant no inserta nada y devuelve null', async () => {
  const { factory } = fakeFactory(() => ({ rows: [] }));
  const repo = new PgNotificacionRepository({ pgPoolFactory: factory });

  assert.equal(
    await repo.createForAlly(ctxCliente, { allyId: ALLY, tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload: {} }),
    null
  );
});

test('notificaciones: lista por tenant, tipo y solicitud y mapea payload y fecha', async () => {
  const sent = new Date('2026-10-18T10:00:00Z');
  const { factory, negocio } = fakeFactory(() => ({ rows: [{ payload: { requestId: SOLICITUD }, enviado_at: sent }] }));
  const repo = new PgNotificacionRepository({ pgPoolFactory: factory });

  const rows = await repo.listByRequest(ctxCliente, SOLICITUD, 'OFERTA_DESPACHO');

  assert.deepEqual(rows, [{ payload: { requestId: SOLICITUD }, enviadoAt: sent }]);
  assert.deepEqual(negocio()[0].params, [TENANT, 'OFERTA_DESPACHO', SOLICITUD]);
  assert.match(negocio()[0].sql, /tenant_id = \$1/);
});

test('notificaciones: la bandeja lista solo las del usuario de la sesión, más recientes primero', async () => {
  const sent = new Date('2026-10-25T10:00:00Z');
  const { factory, negocio } = fakeFactory(() => ({
    rows: [{ id: 'n-2', tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload: { requestId: SOLICITUD }, enviado_at: sent, leido_at: null }],
  }));
  const repo = new PgNotificacionRepository({ pgPoolFactory: factory });

  const rows = await repo.listForUser(ctxAliado, { limit: 20 });

  assert.deepEqual(rows, [
    { id: 'n-2', tipo: 'OFERTA_DESPACHO', canal: 'PUSH', payload: { requestId: SOLICITUD }, enviadoAt: sent, leidoAt: null },
  ]);
  assert.deepEqual(negocio()[0].params, [TENANT, USER, 20]);
  assert.match(negocio()[0].sql, /tenant_id = \$1 AND usuario_id = \$2/);
  assert.match(negocio()[0].sql, /ORDER BY enviado_at DESC/);
});

const PgSolicitudAsignacionRepository = require('../../../src/infrastructure/repositories/PgSolicitudAsignacionRepository');

// Responde cada sentencia de la asignación según su contenido.
function respuestasAsignacion({ aliado = { id: ALLY, estado_verificacion: 'VERIFICADO', estado_usuario: 'ACTIVO' }, fila, oferta = true, elegible = true, actualizadas = 1 } = {}) {
  return (sql) => {
    if (sql.includes('FROM aliado a\n  JOIN usuario u')) return { rows: aliado ? [aliado] : [] };
    if (sql.includes('FOR UPDATE')) return { rows: fila ? [fila] : [] };
    if (sql.includes('AS tiene_oferta')) return { rows: [{ tiene_oferta: oferta }] };
    if (sql.includes('AS elegible')) return { rows: [{ elegible }] };
    if (sql.startsWith('UPDATE solicitud')) return { rowCount: actualizadas, rows: actualizadas ? [{ updated_at: new Date(0) }] : [] };
    return { rows: [], rowCount: 1 };
  };
}
const pendiente = { estado: 'PENDIENTE', aliado_id: null, categoria_id: CATEGORIA, zona_id: ZONA, updated_at: new Date(0) };

test('asignación: bloquea la fila, actualiza con el predicado de versión e inserta evento y aviso', async () => {
  const { factory, sentencias, negocio } = fakeFactory(respuestasAsignacion({ fila: pendiente }));
  const repo = new PgSolicitudAsignacionRepository({ pgPoolFactory: factory });

  const r = await repo.asignar(ctxAliado, SOLICITUD);

  assert.equal(r.asignada, true);
  assert.deepEqual(r.solicitud, { id: SOLICITUD, estado: 'ASIGNADA', aliadoId: ALLY, asignadaEn: new Date(0) });
  assert.deepEqual(contextoFijado(sentencias), [TENANT, USER, 'aliado']);
  const sqls = negocio().map((s) => s.sql);
  assert.match(sqls[1], /FOR UPDATE/);
  const update = negocio().find((s) => s.sql.startsWith('UPDATE solicitud'));
  assert.match(update.sql, /estado = 'PENDIENTE' AND aliado_id IS NULL/);
  assert.deepEqual(update.params, [SOLICITUD, TENANT, ALLY]);
  assert.ok(sqls.some((s) => s.includes("'SOLICITUD_ASIGNADA', 'El aliado aceptó el servicio.'")));
  assert.ok(sqls.some((s) => s.includes("'SOLICITUD_ASIGNADA', 'IN_APP'")));
  assert.equal(sentencias.at(-1).sql, 'COMMIT');
});

test('asignación: cada regla responde su código y revierte sin escribir', async () => {
  const casos = [
    [{ aliado: null, fila: pendiente }, 'MANI-SOL-403'],
    [{ aliado: { id: ALLY, estado_verificacion: 'VERIFICADO', estado_usuario: 'INACTIVO' }, fila: pendiente }, 'MANI-SOL-403'],
    [{ aliado: { id: ALLY, estado_verificacion: 'PENDIENTE', estado_usuario: 'ACTIVO' }, fila: pendiente }, 'MANI-SOL-403V'],
    [{ fila: null }, 'MANI-SOL-404'],
    [{ fila: { ...pendiente, aliado_id: ALLY_2, estado: 'ASIGNADA' } }, 'MANI-SOL-409'],
    [{ fila: { ...pendiente, estado: 'CANCELADA' } }, 'MANI-SOL-409E'],
    [{ fila: pendiente, oferta: false }, 'MANI-SOL-403O'],
    [{ fila: pendiente, elegible: false }, 'MANI-SOL-403E'],
    [{ fila: pendiente, actualizadas: 0 }, 'MANI-SOL-409'],
  ];
  for (const [opciones, codigo] of casos) {
    const { factory, sentencias } = fakeFactory(respuestasAsignacion(opciones));
    await assert.rejects(() => new PgSolicitudAsignacionRepository({ pgPoolFactory: factory }).asignar(ctxAliado, SOLICITUD), (e) => e.code === codigo, codigo);
    assert.equal(sentencias.at(-1).sql, 'ROLLBACK', codigo);
    assert.ok(!sentencias.some((s) => s.sql.startsWith('INSERT')), `${codigo} no escribe`);
  }
});

test('asignación: si ya es del mismo aliado devuelve asignada=false sin escribir nada', async () => {
  const { factory, sentencias } = fakeFactory(respuestasAsignacion({ fila: { ...pendiente, estado: 'ASIGNADA', aliado_id: ALLY } }));

  const r = await new PgSolicitudAsignacionRepository({ pgPoolFactory: factory }).asignar(ctxAliado, SOLICITUD);

  assert.equal(r.asignada, false);
  assert.equal(r.solicitud.estado, 'ASIGNADA');
  assert.ok(!sentencias.some((s) => /^(UPDATE|INSERT)/.test(s.sql)));
});

test('bandeja del aliado: filtra por tenant, usuario y aliado de la sesión y mapea a camelCase', async () => {
  const creada = new Date('2026-10-27T10:00:00Z');
  const { factory, negocio } = fakeFactory((sql) => {
    if (sql.includes('JOIN usuario u')) return { rows: [{ id: ALLY, estado_verificacion: 'VERIFICADO', estado_usuario: 'ACTIVO' }] };
    return {
      rows: [{
        id: SOLICITUD, estado: 'PENDIENTE', es_mia: false, categoria: 'Plomería', flujo_operativo: null, zona: 'Chapinero',
        zona_padre: 'Bogotá', reglas_sitio: {}, direccion: null, created_at: creada, asignada_at: null,
      }],
    };
  });

  const items = await new PgSolicitudAsignacionRepository({ pgPoolFactory: factory }).ofertasDelAliado(ctxAliado);

  assert.deepEqual(items, [{
    id: SOLICITUD, estado: 'PENDIENTE', esMia: false, categoria: 'Plomería', flujoOperativo: null, zona: 'Chapinero',
    zonaPadre: 'Bogotá', reglasSitio: {}, direccion: null, creadaEn: creada, asignadaEn: null,
  }]);
  assert.deepEqual(negocio()[1].params, [TENANT, USER, ALLY]);
  assert.match(negocio()[1].sql, /tipo = 'OFERTA_DESPACHO'/);
  assert.doesNotMatch(negocio()[1].sql, /solicitud_rechazo/, 'los rechazos los filtra Dispatch (T1)');
});
