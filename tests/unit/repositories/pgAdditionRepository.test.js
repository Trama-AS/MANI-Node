const test = require('node:test');
const assert = require('node:assert/strict');
const PgAdditionRepository = require('../../../src/infrastructure/repositories/PgAdditionRepository');
const { DECISIONES } = require('../../../src/application/useCases/additions/RespondAdditionUseCase');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const SOLICITUD = '55555555-5555-4555-8555-555555555555';
const ADICION = '88888888-8888-4888-8888-888888888888';
const aliadoCtx = { tenantId: TENANT, userId: USER, role: 'ALLY' };
const clienteCtx = { tenantId: TENANT, userId: USER, role: 'CLIENT' };

const filaAdicion = (cambios = {}) => ({
  id: ADICION, solicitud_id: SOLICITUD, cotizacion_id: 'cot-1', motivo: 'Tubería rota detrás del muro',
  valor_mano_obra: '100.00', valor_materiales: '50.50', tiempo_adicional_minutos: 90, estado: 'PENDIENTE',
  comentario_cliente: null, respondida_at: null, created_at: new Date('2026-10-28T00:00:00Z'), ...cambios,
});
const totales = (total = '1000.00', aceptadas = '0') => ({ rows: [{ id: 'cot-1', total, aceptadas }] });

// Pool simulado de `pg`: responde según la sentencia (la primera clave que aparezca) y registra la transacción.
function fakeFactory(respuestas = {}) {
  const sentencias = [];
  const client = {
    query: async (sql, params) => {
      sentencias.push({ sql: sql.trim(), params });
      for (const [clave, valor] of Object.entries(respuestas)) {
        if (sql.includes(clave)) {
          if (valor instanceof Error) throw valor;
          return valor;
        }
      }
      return { rows: [] };
    },
    release: () => {},
  };
  return { factory: { getPool: () => ({ connect: async () => client }) }, sentencias };
}

const datosPedido = { solicitudId: SOLICITUD, motivo: 'Tubería rota detrás del muro', valorManoObra: 100, valorMateriales: 50.5, tiempoAdicionalMinutos: 90 };

const pedidoExitoso = (cambios = {}) => ({
  'SELECT id FROM aliado WHERE usuario_id': { rows: [{ id: 'aliado-1' }] },
  'FROM solicitud WHERE id = $1 AND tenant_id = $2 FOR UPDATE': { rows: [{ estado: 'EN_EJECUCION', aliado_id: 'aliado-1' }] },
  "cot.estado = 'ACEPTADA'": totales(),
  'SELECT 1 FROM adicion_servicio': { rows: [] },
  'INSERT INTO adicion_servicio': { rows: [filaAdicion()] },
  'INSERT INTO notificacion': { rows: [{ id: 'notif-1' }] },
  ...cambios,
});

const solicitar = (factory, datos = datosPedido) => new PgAdditionRepository({ pgPoolFactory: factory }).solicitar(aliadoCtx, datos);

test('exige la fábrica de pools', () => {
  assert.throws(() => new PgAdditionRepository({}), /pgPoolFactory es requerido/);
});

test('solicitar: adición, evento y aviso al cliente en una transacción, con el total vigente sin cambios', async () => {
  const { factory, sentencias } = fakeFactory(pedidoExitoso());

  const r = await solicitar(factory);

  assert.deepEqual(r.adicion, {
    id: ADICION, solicitudId: SOLICITUD, cotizacionId: 'cot-1', motivo: 'Tubería rota detrás del muro', valorManoObra: 100,
    valorMateriales: 50.5, total: 150.5, tiempoAdicionalMinutos: 90, estado: 'PENDIENTE', comentarioCliente: null,
    respondidaEn: null, creadaEn: new Date('2026-10-28T00:00:00Z'),
  });
  assert.deepEqual(r.resumen, {
    cotizacionId: 'cot-1', totalCotizacion: 1000, totalAdicionesAceptadas: 0, totalVigente: 1000, topeAdiciones: 500,
    disponibleParaAdiciones: 500,
  });
  assert.equal(r.notificacionId, 'notif-1');
  assert.equal(sentencias[0].sql, 'BEGIN');
  assert.deepEqual(sentencias[1].params, [TENANT, USER, 'aliado']);
  const insert = sentencias.find((s) => s.sql.startsWith('INSERT INTO adicion_servicio'));
  assert.deepEqual(insert.params, [TENANT, SOLICITUD, 'cot-1', 'aliado-1', 'Tubería rota detrás del muro', 100, 50.5, 90]);
  const evento = sentencias.find((s) => s.sql.startsWith('INSERT INTO evento_servicio'));
  assert.match(evento.sql, /'ADICION_SOLICITADA'/);
  assert.match(evento.params[3], /total 150.5/);
  const aviso = sentencias.find((s) => s.sql.startsWith('INSERT INTO notificacion'));
  assert.match(aviso.sql, /'ADICION_SOLICITADA', 'PUSH'/);
  assert.deepEqual(JSON.parse(aviso.params[2]), { requestId: SOLICITUD, adicionId: ADICION, total: 150.5 });
  assert.equal(aviso.params[3], `adicion-solicitada:${ADICION}`);
  assert.equal(sentencias.at(-1).sql, 'COMMIT');
});

test('solicitar: sin perfil de aliado, aliado no asignado y solicitud inexistente', async () => {
  const sinPerfil = fakeFactory(pedidoExitoso({ 'SELECT id FROM aliado WHERE usuario_id': { rows: [] } }));
  await assert.rejects(solicitar(sinPerfil.factory), { code: 'MANI-ADI-403A' });

  const otro = fakeFactory(pedidoExitoso({
    'FROM solicitud WHERE id = $1 AND tenant_id = $2 FOR UPDATE': { rows: [{ estado: 'EN_EJECUCION', aliado_id: 'aliado-2' }] },
  }));
  await assert.rejects(solicitar(otro.factory), { code: 'MANI-ADI-403A' });

  const inexistente = fakeFactory(pedidoExitoso({ 'FROM solicitud WHERE id = $1 AND tenant_id = $2 FOR UPDATE': { rows: [] } }));
  await assert.rejects(solicitar(inexistente.factory), { code: 'MANI-ADI-404' });
  assert.equal(inexistente.sentencias.at(-1).sql, 'ROLLBACK');
});

test('solicitar: 409 si el servicio no está en ejecución o no tiene cotización aceptada', async () => {
  for (const estado of ['ACEPTADA', 'FINALIZADA', 'CANCELADA']) {
    const { factory } = fakeFactory(pedidoExitoso({
      'FROM solicitud WHERE id = $1 AND tenant_id = $2 FOR UPDATE': { rows: [{ estado, aliado_id: 'aliado-1' }] },
    }));
    await assert.rejects(solicitar(factory), { code: 'MANI-ADI-409E' });
  }
  const sinCotizacion = fakeFactory(pedidoExitoso({ "cot.estado = 'ACEPTADA'": { rows: [] } }));
  await assert.rejects(solicitar(sinCotizacion.factory), { code: 'MANI-ADI-409C' });
});

test('solicitar: 409P con otra adición pendiente, también si gana la carrera otra transacción', async () => {
  const pendiente = fakeFactory(pedidoExitoso({ 'SELECT 1 FROM adicion_servicio': { rows: [{ '?column?': 1 }] } }));
  await assert.rejects(solicitar(pendiente.factory), { code: 'MANI-ADI-409P' });
  assert.equal(pendiente.sentencias.some((s) => s.sql.startsWith('INSERT INTO adicion_servicio')), false);

  const carrera = fakeFactory(pedidoExitoso({ 'INSERT INTO adicion_servicio': Object.assign(new Error('duplicate'), { code: '23505' }) }));
  await assert.rejects(solicitar(carrera.factory), { code: 'MANI-ADI-409P' });

  const otroFallo = fakeFactory(pedidoExitoso({ 'INSERT INTO adicion_servicio': Object.assign(new Error('caída'), { code: '08006' }) }));
  await assert.rejects(solicitar(otroFallo.factory), /caída/);
});

test('solicitar: el tope del 50 % de la cotización aceptada admite el límite exacto y rechaza un centavo más', async () => {
  // Cotización de 1000 → tope 500; ya hay 349.50 aceptados: caben 150.50 exactos.
  const justo = fakeFactory(pedidoExitoso({ "cot.estado = 'ACEPTADA'": totales('1000.00', '349.50') }));
  const r = await solicitar(justo.factory);
  assert.equal(r.resumen.disponibleParaAdiciones, 150.5);

  const excede = fakeFactory(pedidoExitoso({ "cot.estado = 'ACEPTADA'": totales('1000.00', '349.51') }));
  await assert.rejects(solicitar(excede.factory), (err) => {
    assert.equal(err.code, 'MANI-ADI-400T');
    assert.match(err.message, /50 %/);
    assert.match(err.message, /disponible: 150.49, solicitado: 150.5/);
    return true;
  });
  assert.equal(excede.sentencias.some((s) => s.sql.startsWith('INSERT INTO adicion_servicio')), false);
});

test('listar: adiciones de la más reciente a la más antigua y resumen; null sin cotización aceptada; 404 si no es visible', async () => {
  const visible = { 'LEFT JOIN aliado a': { rows: [{ estado: 'EN_EJECUCION' }] } };
  const con = fakeFactory({
    ...visible,
    "cot.estado = 'ACEPTADA'": totales('1000.00', '200.00'),
    'ORDER BY created_at DESC': { rows: [filaAdicion({ estado: 'ACEPTADA', respondida_at: new Date('2026-10-28T01:00:00Z') })] },
  });
  const repo = new PgAdditionRepository({ pgPoolFactory: con.factory });
  const r = await repo.listarPorSolicitud(clienteCtx, SOLICITUD);
  assert.equal(r.adiciones.length, 1);
  assert.equal(r.adiciones[0].estado, 'ACEPTADA');
  assert.equal(r.resumen.totalVigente, 1200);
  assert.equal(r.resumen.disponibleParaAdiciones, 300);

  const sin = fakeFactory(visible);
  assert.equal((await new PgAdditionRepository({ pgPoolFactory: sin.factory }).listarPorSolicitud(clienteCtx, SOLICITUD)).resumen, null);

  const ajena = fakeFactory({});
  await assert.rejects(new PgAdditionRepository({ pgPoolFactory: ajena.factory }).listarPorSolicitud(clienteCtx, SOLICITUD), {
    code: 'MANI-ADI-404',
  });
});

const filaDecision = (cambios = {}) => ({
  estado: 'PENDIENTE', aliado_id: 'aliado-1', valor_mano_obra: '100.00', valor_materiales: '50.50',
  solicitud_id: SOLICITUD, cliente_id: 'cliente-1', estado_solicitud: 'EN_EJECUCION', ...cambios,
});
const decisionExitosa = (estadoNuevo, cambios = {}) => ({
  'FROM cliente c JOIN usuario u': { rows: [{ id: 'cliente-1' }] },
  'FOR UPDATE OF ad, s': { rows: [filaDecision()] },
  "cot.estado = 'ACEPTADA'": totales(),
  'UPDATE adicion_servicio': { rows: [filaAdicion({ estado: estadoNuevo, respondida_at: new Date('2026-10-28T02:00:00Z') })] },
  'INSERT INTO notificacion': { rows: [{ id: 'notif-2' }] },
  ...cambios,
});
const decidir = (factory, accion, comentario = '') =>
  new PgAdditionRepository({ pgPoolFactory: factory }).responder(clienteCtx, { adicionId: ADICION, decision: DECISIONES[accion], comentario });

test('responder: aceptar actualiza la adición, deja el evento y avisa al aliado', async () => {
  const { factory, sentencias } = fakeFactory(decisionExitosa('ACEPTADA'));

  const r = await decidir(factory, 'ACEPTAR');

  assert.equal(r.adicion.estado, 'ACEPTADA');
  assert.equal(r.notificacionId, 'notif-2');
  assert.ok(r.resumen);
  assert.deepEqual(sentencias.find((s) => s.sql.includes('FOR UPDATE OF ad, s')).params, [ADICION, TENANT]);
  assert.deepEqual(sentencias.find((s) => s.sql.startsWith('UPDATE adicion_servicio')).params, ['ACEPTADA', '', USER, ADICION, TENANT]);
  const evento = sentencias.find((s) => s.sql.startsWith('INSERT INTO evento_servicio'));
  assert.deepEqual(evento.params, [TENANT, SOLICITUD, USER, 'ADICION_ACEPTADA', 'Adición de 150.5']);
  const aviso = sentencias.find((s) => s.sql.startsWith('INSERT INTO notificacion'));
  assert.match(aviso.sql, /'RESPUESTA_ADICION', 'PUSH'/);
  assert.deepEqual(JSON.parse(aviso.params[2]), { requestId: SOLICITUD, adicionId: ADICION, decision: 'ACEPTAR' });
  assert.equal(aviso.params[3], `respuesta-adicion:${ADICION}`);
  assert.equal(sentencias.at(-1).sql, 'COMMIT');
});

test('responder: rechazar guarda el comentario y no revisa el tope; vale con el servicio ya finalizado', async () => {
  const { factory, sentencias } = fakeFactory(decisionExitosa('RECHAZADA', {
    'FOR UPDATE OF ad, s': { rows: [filaDecision({ estado_solicitud: 'FINALIZADA' })] },
    "cot.estado = 'ACEPTADA'": totales('1000.00', '500.00'),
  }));

  const r = await decidir(factory, 'RECHAZAR', 'No estaba pactado');

  assert.equal(r.adicion.estado, 'RECHAZADA');
  const evento = sentencias.find((s) => s.sql.startsWith('INSERT INTO evento_servicio'));
  assert.deepEqual(evento.params.slice(3), ['ADICION_RECHAZADA', 'Adición de 150.5: No estaba pactado']);
});

test('responder: 404 a otro cliente, 409R si ya se decidió, 409E si la solicitud no admite decisiones, 403C sin cliente activo', async () => {
  const ajena = fakeFactory(decisionExitosa('ACEPTADA', { 'FOR UPDATE OF ad, s': { rows: [filaDecision({ cliente_id: 'cliente-2' })] } }));
  await assert.rejects(decidir(ajena.factory, 'ACEPTAR'), { code: 'MANI-ADI-404' });
  const inexistente = fakeFactory(decisionExitosa('ACEPTADA', { 'FOR UPDATE OF ad, s': { rows: [] } }));
  await assert.rejects(decidir(inexistente.factory, 'ACEPTAR'), { code: 'MANI-ADI-404' });

  const decidida = fakeFactory(decisionExitosa('ACEPTADA', { 'FOR UPDATE OF ad, s': { rows: [filaDecision({ estado: 'RECHAZADA' })] } }));
  await assert.rejects(decidir(decidida.factory, 'ACEPTAR'), { code: 'MANI-ADI-409R' });

  const cancelada = fakeFactory(decisionExitosa('ACEPTADA', { 'FOR UPDATE OF ad, s': { rows: [filaDecision({ estado_solicitud: 'CANCELADA' })] } }));
  await assert.rejects(decidir(cancelada.factory, 'RECHAZAR'), { code: 'MANI-ADI-409E' });

  const inactivo = fakeFactory(decisionExitosa('ACEPTADA', { 'FROM cliente c JOIN usuario u': { rows: [] } }));
  await assert.rejects(decidir(inactivo.factory, 'ACEPTAR'), { code: 'MANI-ADI-403C' });
});

test('responder: aceptar vuelve a comprobar el tope y no cambia nada si lo supera', async () => {
  const { factory, sentencias } = fakeFactory(decisionExitosa('ACEPTADA', { "cot.estado = 'ACEPTADA'": totales('1000.00', '400.00') }));

  await assert.rejects(decidir(factory, 'ACEPTAR'), { code: 'MANI-ADI-400T' });
  assert.equal(sentencias.some((s) => s.sql.startsWith('UPDATE adicion_servicio')), false);
  assert.equal(sentencias.at(-1).sql, 'ROLLBACK');
});
