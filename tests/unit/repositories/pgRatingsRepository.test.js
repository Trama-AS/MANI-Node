const test = require('node:test');
const assert = require('node:assert/strict');
const PgRatingsRepository = require('../../../src/infrastructure/repositories/PgRatingsRepository');

const TENANT = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';
const ALLY = '33333333-3333-4333-8333-333333333333';
const SOLICITUD = '44444444-4444-4444-8444-444444444444';

const ctxCliente = { tenantId: TENANT, userId: USER, role: 'CLIENT' };
const ctxAliado = { tenantId: TENANT, userId: ALLY, role: 'ALLY' };
const ctxAdmin = { tenantId: TENANT, userId: USER, role: 'ADMIN' };

function fakeFactory(respuestas = {}) {
  const sentencias = [];
  const responder = (sql, params) => {
    for (const [clave, valor] of Object.entries(respuestas)) {
      if (sql.includes(clave)) return typeof valor === 'function' ? valor(sql, params) : valor;
    }
    return { rows: [] };
  };
  const client = {
    query: async (sql, params) => {
      sentencias.push({ sql: sql.trim(), params });
      if (/^(BEGIN|COMMIT|ROLLBACK)/.test(sql.trim()) || sql.includes('app.set_context')) return { rows: [] };
      return responder(sql, params);
    },
    release: () => {},
  };
  return { factory: { getPool: () => ({ connect: async () => client }) }, sentencias };
}

test('PgRatingsRepository: constructor exige pgPoolFactory', () => {
  assert.throws(() => new PgRatingsRepository({}), /pgPoolFactory es requerido/);
});

test('PgRatingsRepository: listarReputacionAliados formatea promedios y etiquetas', async () => {
  const { factory } = fakeFactory({
    'FROM aliado a': {
      rows: [
        {
          id: 'ali-1',
          nombre_razon_social: 'Pedro Perez',
          tipo: 'PERSONA_NATURAL',
          estado_verificacion: 'VERIFICADO',
          total_calificaciones: 4,
          calificacion_promedio: 4.75,
        },
        {
          id: 'ali-2',
          nombre_razon_social: 'Servicios SAS',
          tipo: 'EMPRESA',
          estado_verificacion: 'VERIFICADO',
          total_calificaciones: 0,
          calificacion_promedio: null,
        },
      ],
    },
  });

  const repo = new PgRatingsRepository({ pgPoolFactory: factory });
  const lista = await repo.listarReputacionAliados(ctxCliente, { categoriaId: 'cat-1', zonaId: 'zon-1' });

  assert.equal(lista.length, 2);
  assert.equal(lista[0].etiquetaCalificacion, '4.8 (4)');
  assert.equal(lista[0].sinValorar, false);
  assert.equal(lista[1].etiquetaCalificacion, 'Sin valorar');
  assert.equal(lista[1].sinValorar, true);
});

test('PgRatingsRepository: obtenerReputacionAliado retorna 404 si no existe o devuelve reputación', async () => {
  const { factory: factory404 } = fakeFactory({ 'FROM aliado a': { rows: [] } });
  const repo404 = new PgRatingsRepository({ pgPoolFactory: factory404 });
  await assert.rejects(() => repo404.obtenerReputacionAliado(ctxCliente, ALLY), (e) => e.statusCode === 404);

  const { factory: factoryOk } = fakeFactory({
    'FROM aliado a': {
      rows: [{ id: ALLY, usuario_id: 'usr-ali', nombre_razon_social: 'Ana Gomez', tipo: 'PERSONA_NATURAL', estado_verificacion: 'VERIFICADO' }],
    },
    'SELECT COUNT(c.id)::int AS total': {
      rows: [{ total: 2, promedio: 4.5 }],
    },
  });
  const repoOk = new PgRatingsRepository({ pgPoolFactory: factoryOk });
  const rep = await repoOk.obtenerReputacionAliado(ctxCliente, ALLY);
  assert.equal(rep.aliadoId, ALLY);
  assert.equal(rep.calificacionPromedio, 4.5);
  assert.equal(rep.totalCalificaciones, 2);
});

test('PgRatingsRepository: obtenerPoliticaCancelacion devuelve defaults si no hay fila o mapea la existente', async () => {
  const { factory: factoryDefault } = fakeFactory({ 'FROM politica_cancelacion_tenant': { rows: [] } });
  const repoDef = new PgRatingsRepository({ pgPoolFactory: factoryDefault });
  const def = await repoDef.obtenerPoliticaCancelacion(ctxAdmin);
  assert.equal(def.configurada, false);
  assert.equal(def.ventanaGratuitaMinutos, 15);
  assert.equal(def.tipoCobro, 'MONTO_FIJO');

  const { factory: factoryExistente } = fakeFactory({
    'FROM politica_cancelacion_tenant': {
      rows: [
        {
          tenant_id: TENANT,
          activa: true,
          ventana_gratuita_minutos: 25,
          tipo_cobro: 'PORCENTAJE',
          valor: 15,
          estados_gravables: ['ASIGNADA', 'COTIZANDO'],
          updated_at: new Date('2026-10-28T18:00:00Z'),
        },
      ],
    },
  });
  const repoExistente = new PgRatingsRepository({ pgPoolFactory: factoryExistente });
  const pol = await repoExistente.obtenerPoliticaCancelacion(ctxAdmin);
  assert.equal(pol.configurada, true);
  assert.equal(pol.activa, true);
  assert.equal(pol.ventanaGratuitaMinutos, 25);
  assert.equal(pol.tipoCobro, 'PORCENTAJE');
});

test('PgRatingsRepository: configurarPoliticaCancelacion realiza upsert y devuelve entidad configurada', async () => {
  const { factory } = fakeFactory({
    'INSERT INTO politica_cancelacion_tenant': {
      rows: [
        {
          tenant_id: TENANT,
          activa: true,
          ventana_gratuita_minutos: 20,
          tipo_cobro: 'MONTO_FIJO',
          valor: 30000,
          estados_gravables: ['ASIGNADA', 'ACEPTADA'],
          updated_at: new Date('2026-10-28T19:00:00Z'),
        },
      ],
    },
  });
  const repo = new PgRatingsRepository({ pgPoolFactory: factory });
  const res = await repo.configurarPoliticaCancelacion(ctxAdmin, {
    activa: true,
    ventanaGratuitaMinutos: 20,
    tipoCobro: 'MONTO_FIJO',
    valor: 30000,
    estadosGravables: ['ASIGNADA', 'ACEPTADA'],
  });
  assert.equal(res.configurada, true);
  assert.equal(res.valor, 30000);
});

test('PgRatingsRepository: previsualizarCancelacion lanza 404 si no encuentra o devuelve estado de cancelada previa', async () => {
  const { factory: f404 } = fakeFactory({ 'FROM solicitud s': { rows: [] } });
  const repo404 = new PgRatingsRepository({ pgPoolFactory: f404 });
  await assert.rejects(() => repo404.previsualizarCancelacion(ctxCliente, SOLICITUD), (e) => e.statusCode === 404);

  const { factory: fCancelada } = fakeFactory({
    'FROM solicitud s': {
      rows: [
        {
          id: SOLICITUD,
          estado: 'CANCELADA',
          penalizacion_aplicada: true,
          penalizacion_monto: 25000,
          penalizacion_motivo: 'CANCELACION_TARDIA',
        },
      ],
    },
  });
  const repoCancelada = new PgRatingsRepository({ pgPoolFactory: fCancelada });
  const res = await repoCancelada.previsualizarCancelacion(ctxCliente, SOLICITUD);
  assert.equal(res.solicitudId, SOLICITUD);
  assert.equal(res.aplicaPenalizacion, true);
  assert.equal(res.montoPenalizacion, 25000);
});

test('PgRatingsRepository: consultarCalificacionesYCierre y obtenerTrabajoAliado', async () => {
  const { factory } = fakeFactory({
    'FROM solicitud s': {
      rows: [
        {
          id: SOLICITUD,
          tenant_id: TENANT,
          estado: 'CERRADA',
          cliente_id: 'cli-1',
          aliado_id: ALLY,
          cliente_usuario_id: USER,
          aliado_usuario_id: ALLY,
          aliado_nombre: 'Plomero Pro',
          aliado_tipo: 'PERSONA_NATURAL',
          aliado_verificacion: 'VERIFICADO',
          cerrada_at: new Date('2026-10-28T12:00:00Z'),
          categoria: 'Plomería',
          flujo_operativo: 'COTIZACION_PREVIA',
          descripcion: 'Arreglo',
          direccion: 'Cra 15 # 80',
          zona: 'Usaquén',
          zona_nivel: 'LOCALIDAD',
          zona_padre: 'Bogotá',
          created_at: new Date('2026-10-28T09:00:00Z'),
          updated_at: new Date('2026-10-28T12:00:00Z'),
          penalizacion_aplicada: false,
          penalizacion_monto: 0,
        },
      ],
    },
    'FROM calificacion': {
      rows: [
        {
          id: 'cal-1',
          solicitud_id: SOLICITUD,
          autor_id: USER,
          destinatario_id: ALLY,
          puntaje: 5,
          comentario: 'Excelente',
          created_at: new Date('2026-10-28T10:00:00Z'),
        },
      ],
    },
    'FROM aliado WHERE usuario_id': {
      rows: [{ id: ALLY, usuario_id: ALLY }],
    },
  });

  const repo = new PgRatingsRepository({ pgPoolFactory: factory });
  const resumen = await repo.consultarCalificacionesYCierre(ctxCliente, SOLICITUD);
  assert.equal(resumen.cierre.solicitudId, SOLICITUD);

  const trabajo = await repo.obtenerTrabajoAliado(ctxAliado, SOLICITUD);
  assert.equal(trabajo.id, SOLICITUD);

  await assert.rejects(() => repo.obtenerTrabajoAliado(ctxAliado, '00000000-0000-4000-8000-000000000000'), (e) => e.statusCode === 404);
});

test('PgRatingsRepository: listarHistorialCliente y listarHistorialAliado mapean correctamente', async () => {
  const { factory } = fakeFactory({
    'FROM aliado WHERE usuario_id': {
      rows: [{ id: ALLY, usuario_id: ALLY }],
    },
    'FROM solicitud s': {
      rows: [
        {
          id: SOLICITUD,
          estado: 'CERRADA',
          categoria: 'Plomería',
          flujo_operativo: 'COTIZACION_PREVIA',
          descripcion: 'Fuga',
          direccion: 'Calle 50',
          zona: 'Suba',
          zona_nivel: 'LOCALIDAD',
          zona_padre: 'Bogotá',
          aliado_id: ALLY,
          aliado_nombre: 'Plomero Pro',
          penalizacion_aplicada: false,
          penalizacion_monto: 0,
          penalizacion_motivo: null,
          created_at: new Date('2026-10-28T08:00:00Z'),
          updated_at: new Date('2026-10-28T11:00:00Z'),
          cerrada_at: new Date('2026-10-28T11:00:00Z'),
          calificacion_cliente_puntaje: 5,
          calificacion_cliente_comentario: 'Bien',
          calificacion_aliado_puntaje: 5,
          calificacion_aliado_comentario: 'Bien',
          valor_cotizado: 80000,
        },
      ],
    },
  });

  const repo = new PgRatingsRepository({ pgPoolFactory: factory });
  const histCli = await repo.listarHistorialCliente(ctxCliente, {});
  assert.equal(histCli.length, 1);
  assert.equal(histCli[0].categoria, 'Plomería');

  const histAli = await repo.listarHistorialAliado(ctxAliado, {});
  assert.equal(histAli.length, 1);
  assert.equal(histAli[0].zonaDeclarada.nombre, 'Suba');
});
