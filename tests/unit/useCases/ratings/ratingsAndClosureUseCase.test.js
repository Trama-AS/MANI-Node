const test = require('node:test');
const assert = require('node:assert/strict');
const RatingsAndClosureUseCase = require('../../../../src/application/useCases/ratings/RatingsAndClosureUseCase');
const PgRatingsRepository = require('../../../../src/infrastructure/repositories/PgRatingsRepository');
const { calcularPenalizacionCancelacion } = require('../../../../src/infrastructure/repositories/calculoPenalizacionCancelacion');

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const CLIENTE_USER = '33333333-3333-4333-8333-333333333333';
const ALIADO_USER = '44444444-4444-4444-8444-444444444444';
const ADMIN_USER = '55555555-5555-4555-8555-555555555555';
const SOLICITUD_ID = '66666666-6666-4666-8666-666666666666';
const ALIADO_ID = '77777777-7777-4777-8777-777777777777';

const sesionCliente = { tenantId: TENANT_A, userId: CLIENTE_USER, role: 'CLIENT' };
const sesionAliado = { tenantId: TENANT_A, userId: ALIADO_USER, role: 'ALLY' };
const sesionAdmin = { tenantId: TENANT_A, userId: ADMIN_USER, role: 'ADMIN' };

test('RatingsAndClosureUseCase exige ratingsRepository al construirse', () => {
  assert.throws(() => new RatingsAndClosureUseCase({}), /ratingsRepository/);
});

test('SCRUM-874 y SCRUM-875 (C1/C2/C3): valida sesión, rol, UUID, rango 1..5 y comentario', async () => {
  const llamadas = [];
  const uc = new RatingsAndClosureUseCase({
    ratingsRepository: {
      registrarCalificacion: async (ctx, datos) => {
        llamadas.push({ ctx, datos });
        return {
          calificacion: { id: 'cal-1', ...datos },
          cierre: { solicitudId: datos.solicitudId, cierreCompleto: false },
        };
      },
    },
  });

  // C1: cliente titular califica con puntaje 5 y comentario recortado
  const resCliente = await uc.calificar({
    user: sesionCliente,
    solicitudId: SOLICITUD_ID,
    body: { puntaje: 5, comentario: '  Excelente trabajo  ' },
  });
  assert.equal(resCliente.calificacion.puntaje, 5);
  assert.equal(llamadas[0].datos.comentario, 'Excelente trabajo');
  assert.equal(llamadas[0].ctx.tenantId, TENANT_A);

  // C1: aliado asignado califica con puntaje 4 sin comentario
  const resAliado = await uc.calificar({
    user: sesionAliado,
    solicitudId: SOLICITUD_ID,
    body: { puntaje: 4 },
  });
  assert.equal(resAliado.calificacion.puntaje, 4);
  assert.equal(llamadas[1].datos.comentario, null);

  // C2: puntajes fuera de rango (0, 6, decimal, booleano, vacío) se rechazan con 422 MANI-CAL-422P
  for (const puntajeInvalido of [0, 6, -1, 3.5, true, '', null, undefined]) {
    await assert.rejects(
      () => uc.calificar({ user: sesionCliente, solicitudId: SOLICITUD_ID, body: { puntaje: puntajeInvalido } }),
      (err) => err.statusCode === 422 && err.code === 'MANI-CAL-422P'
    );
  }

  // Comentario mayor a 500 caracteres se rechaza con 422 MANI-CAL-422C
  await assert.rejects(
    () => uc.calificar({ user: sesionCliente, solicitudId: SOLICITUD_ID, body: { puntaje: 5, comentario: 'x'.repeat(501) } }),
    (err) => err.statusCode === 422 && err.code === 'MANI-CAL-422C'
  );

  // C3: rol ADMIN no puede calificar un servicio (403 MANI-CAL-403)
  await assert.rejects(
    () => uc.calificar({ user: sesionAdmin, solicitudId: SOLICITUD_ID, body: { puntaje: 5 } }),
    (err) => err.statusCode === 403 && err.code === 'MANI-CAL-403'
  );

  // Sesión sin tenant o sin userId válido responde 401 MANI-CAL-401
  await assert.rejects(
    () => uc.calificar({ user: { role: 'CLIENT' }, solicitudId: SOLICITUD_ID, body: { puntaje: 5 } }),
    (err) => err.statusCode === 401 && err.code === 'MANI-CAL-401'
  );
});

test('SCRUM-878: configurarPoliticaCancelacion exige rol ADMIN, valida parámetros y registra auditoría (T10)', async () => {
  const auditoria = [];
  const uc = new RatingsAndClosureUseCase({
    ratingsRepository: {
      configurarPoliticaCancelacion: async (ctx, pol) => ({ tenantId: ctx.tenantId, ...pol, configurada: true }),
    },
    auditLogger: (entry) => auditoria.push(entry),
  });

  await assert.rejects(
    () => uc.configurarPoliticaCancelacion({ user: sesionCliente, body: { activa: true, valor: 15000 } }),
    (err) => err.statusCode === 403 && err.code === 'MANI-PEN-403'
  );

  await assert.rejects(
    () => uc.configurarPoliticaCancelacion({ user: sesionAdmin, body: { activa: true, tipoCobro: 'PORCENTAJE', valor: 150 } }),
    (err) => err.statusCode === 422 && err.code === 'MANI-PEN-422'
  );

  const pol = await uc.configurarPoliticaCancelacion({
    user: sesionAdmin,
    body: { activa: true, ventanaGratuitaMinutos: 20, tipoCobro: 'MONTO_FIJO', valor: 25000 },
    correlationId: 'corr-pen-1',
  });
  assert.equal(pol.activa, true);
  assert.equal(pol.valor, 25000);
  assert.equal(auditoria.length, 1);
  assert.equal(auditoria[0].action, 'CONFIGURE_CANCELLATION_POLICY');
  assert.equal(auditoria[0].tenantId, TENANT_A);
});

test('SCRUM-878: calcularPenalizacionCancelacion respeta C1 (política vigente), C2 (sin política no cobra) y ventana gratuita', async () => {
  const solicitudBase = {
    id: SOLICITUD_ID,
    estado: 'ASIGNADA',
    aliado_id: ALIADO_ID,
    created_at: new Date(Date.now() - 3600 * 1000),
    updated_at: new Date(Date.now() - 3600 * 1000),
  };

  // C2: sin política vigente en el tenant -> no se cobra arbitrariamente
  const sinPoliticaClient = {
    query: async () => ({ rows: [] }),
  };
  const rSinPol = await calcularPenalizacionCancelacion(sinPoliticaClient, TENANT_A, solicitudBase);
  assert.equal(rSinPol.aplicaPenalizacion, false);
  assert.equal(rSinPol.montoPenalizacion, 0);
  assert.equal(rSinPol.razon, 'SIN_POLITICA_VIGENTE');

  // C2: dentro de la ventana gratuita -> 0
  const enVentanaClient = {
    query: async (sql) => {
      if (sql.includes('politica_cancelacion_tenant')) {
        return {
          rows: [{ activa: true, ventana_gratuita_minutos: 30, tipo_cobro: 'MONTO_FIJO', valor: 20000, estados_gravables: ['ASIGNADA'] }],
        };
      }
      return { rows: [{ minutos_transcurridos: 5 }] };
    },
  };
  const rEnVentana = await calcularPenalizacionCancelacion(enVentanaClient, TENANT_A, solicitudBase);
  assert.equal(rEnVentana.aplicaPenalizacion, false);
  assert.equal(rEnVentana.montoPenalizacion, 0);
  assert.equal(rEnVentana.razon, 'DENTRO_DE_VENTANA_GRATUITA');

  // C1: cancelación tardía con política activa MONTO_FIJO -> calcula y devuelve el monto exacto
  const tardiaFijoClient = {
    query: async (sql) => {
      if (sql.includes('politica_cancelacion_tenant')) {
        return {
          rows: [{ activa: true, ventana_gratuita_minutos: 15, tipo_cobro: 'MONTO_FIJO', valor: 28000, estados_gravables: ['ASIGNADA', 'ACEPTADA'] }],
        };
      }
      return { rows: [{ minutos_transcurridos: 45 }] };
    },
  };
  const rTardiaFijo = await calcularPenalizacionCancelacion(tardiaFijoClient, TENANT_A, solicitudBase);
  assert.equal(rTardiaFijo.aplicaPenalizacion, true);
  assert.equal(rTardiaFijo.montoPenalizacion, 28000);
  assert.equal(rTardiaFijo.razon, 'CANCELACION_TARDIA_SEGUN_POLITICA');

  // C1: cancelación tardía con política PORCENTAJE (20% sobre cotización de 150.000 = 30.000)
  const tardiaPorcentajeClient = {
    query: async (sql) => {
      if (sql.includes('politica_cancelacion_tenant')) {
        return {
          rows: [{ activa: true, ventana_gratuita_minutos: 10, tipo_cobro: 'PORCENTAJE', valor: 20, estados_gravables: ['ACEPTADA'] }],
        };
      }
      if (sql.includes('FROM cotizacion')) {
        return { rows: [{ total: 150000 }] };
      }
      return { rows: [{ minutos_transcurridos: 25 }] };
    },
  };
  const rTardiaPct = await calcularPenalizacionCancelacion(tardiaPorcentajeClient, TENANT_A, {
    ...solicitudBase,
    estado: 'ACEPTADA',
  });
  assert.equal(rTardiaPct.aplicaPenalizacion, true);
  assert.equal(rTardiaPct.montoPenalizacion, 30000);
  assert.equal(rTardiaPct.baseCotizacion, 150000);
});

test('PgRatingsRepository: flujo completo en memoria de 874 -> 875 -> 1418 (cierre condicionado) y 876 (sin valorar vs promedio)', async () => {
  const calificacionesGuardadas = [];
  let estadoSolicitud = 'FINALIZADA';
  let cerradaAt = null;

  const fakeClient = {
    query: async (sql, params) => {
      if (sql.includes('SELECT app.set_context')) return { rows: [] };
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return { rows: [] };
      if (sql.includes('FROM solicitud s') && sql.includes('cliente_usuario_id')) {
        const [solId, tenantId] = params;
        if (solId !== SOLICITUD_ID || tenantId !== TENANT_A) return { rows: [] };
        return {
          rows: [
            {
              id: SOLICITUD_ID,
              tenant_id: TENANT_A,
              estado: estadoSolicitud,
              aliado_id: ALIADO_ID,
              cliente_id: 'cli-1',
              cerrada_at: cerradaAt,
              cliente_usuario_id: CLIENTE_USER,
              aliado_usuario_id: ALIADO_USER,
              aliado_nombre: 'Carlos Plomero',
              aliado_tipo: 'PERSONA_NATURAL',
              aliado_verificacion: 'VERIFICADO',
            },
          ],
        };
      }
      if (sql.includes('SELECT id FROM calificacion WHERE tenant_id')) {
        const [, , autorId] = params;
        return { rows: calificacionesGuardadas.filter((c) => c.autor_id === autorId) };
      }
      if (sql.includes('INSERT INTO calificacion')) {
        const [, solicitudId, autorId, destinatarioId, puntaje, comentario] = params;
        const nueva = {
          id: `cal-${calificacionesGuardadas.length + 1}`,
          solicitud_id: solicitudId,
          autor_id: autorId,
          destinatario_id: destinatarioId,
          puntaje,
          comentario,
          created_at: new Date('2026-10-28T20:00:00Z'),
        };
        calificacionesGuardadas.push(nueva);
        return { rows: [nueva] };
      }
      if (sql.includes('SELECT autor_id FROM calificacion')) {
        return { rows: calificacionesGuardadas.map((c) => ({ autor_id: c.autor_id })) };
      }
      if (sql.includes("SET estado = 'CERRADA'")) {
        estadoSolicitud = 'CERRADA';
        cerradaAt = new Date('2026-10-28T20:05:00Z');
        return { rows: [{ estado: estadoSolicitud, cerrada_at: cerradaAt }] };
      }
      if (sql.includes('FROM calificacion') && sql.includes('ORDER BY created_at ASC')) {
        return { rows: [...calificacionesGuardadas] };
      }
      if (sql.includes('SELECT COUNT(c.id)::int AS total')) {
        const [, destId] = params;
        const recibidas = calificacionesGuardadas.filter((c) => c.destinatario_id === destId);
        const total = recibidas.length;
        const promedio = total > 0 ? recibidas.reduce((acc, c) => acc + c.puntaje, 0) / total : null;
        return { rows: [{ total, promedio }] };
      }
      if (sql.includes('INSERT INTO notificacion')) {
        return { rows: [{ id: 'noti-cierre-1' }] };
      }
      return { rows: [] };
    },
    release: () => {},
  };

  const repo = new PgRatingsRepository({
    pgPoolFactory: {
      getPool: () => ({ connect: async () => fakeClient }),
    },
  });

  // 1. SCRUM-1418 C2: antes de que existan las dos calificaciones, cerrarSolicitud se rechaza con 409 MANI-CAL-409C
  await assert.rejects(
    () => repo.cerrarSolicitud(sesionCliente, SOLICITUD_ID),
    (err) => err.statusCode === 409 && err.code === 'MANI-CAL-409C'
  );

  // 2. SCRUM-874 C1: cliente titular califica al aliado (puntaje 5)
  const trasCliente = await repo.registrarCalificacion(sesionCliente, {
    solicitudId: SOLICITUD_ID,
    puntaje: 5,
    comentario: 'Muy puntual',
  });
  assert.equal(trasCliente.calificacion.direccion, 'CLIENTE_A_ALIADO');
  assert.equal(trasCliente.cierre.calificacionClienteRegistrada, true);
  assert.equal(trasCliente.cierre.calificacionAliadoRegistrada, false);
  // SCRUM-1418 C2: con una sola calificación NO se declara cierre completo
  assert.equal(trasCliente.cierre.cierreCompleto, false);
  assert.equal(trasCliente.cierre.estadoSolicitud, 'FINALIZADA');

  // 3. SCRUM-874 C2: calificación duplicada del cliente se rechaza con 409 MANI-CAL-409D
  await assert.rejects(
    () => repo.registrarCalificacion(sesionCliente, { solicitudId: SOLICITUD_ID, puntaje: 4, comentario: 'Otra vez' }),
    (err) => err.statusCode === 409 && err.code === 'MANI-CAL-409D'
  );

  // 4. SCRUM-1418 C2: aún falta la calificación del aliado, cerrarSolicitud sigue rechazando con 409
  await assert.rejects(
    () => repo.cerrarSolicitud(sesionCliente, SOLICITUD_ID),
    (err) => err.statusCode === 409 && err.code === 'MANI-CAL-409C'
  );

  // 5. SCRUM-875 C3: otro usuario ajeno del mismo tenant o de otro tenant no puede calificar
  await assert.rejects(
    () =>
      repo.registrarCalificacion(
        { tenantId: TENANT_A, userId: '99999999-9999-4999-8999-999999999999', role: 'ALLY' },
        { solicitudId: SOLICITUD_ID, puntaje: 5 }
      ),
    (err) => err.statusCode === 403 && err.code === 'MANI-CAL-403P'
  );
  await assert.rejects(
    () =>
      repo.registrarCalificacion(
        { tenantId: TENANT_B, userId: ALIADO_USER, role: 'ALLY' },
        { solicitudId: SOLICITUD_ID, puntaje: 5 }
      ),
    (err) => err.statusCode === 404 && err.code === 'MANI-CAL-404'
  );

  // 6. SCRUM-875 C1 + SCRUM-1418 C1: aliado asignado califica al cliente -> se completa cierre bidireccional automáticamente
  const trasAliado = await repo.registrarCalificacion(sesionAliado, {
    solicitudId: SOLICITUD_ID,
    puntaje: 4,
    comentario: 'Cliente amable',
  });
  assert.equal(trasAliado.calificacion.direccion, 'ALIADO_A_CLIENTE');
  assert.equal(trasAliado.cierre.calificacionClienteRegistrada, true);
  assert.equal(trasAliado.cierre.calificacionAliadoRegistrada, true);
  assert.equal(trasAliado.cierre.cierreCompleto, true);
  assert.equal(trasAliado.cierre.estadoSolicitud, 'CERRADA');
  assert.ok(trasAliado.cierre.cerradaEn instanceof Date);
  assert.equal(trasAliado.reputacionAliado.calificacionPromedio, 5);
  assert.equal(trasAliado.reputacionAliado.totalCalificaciones, 1);
});
