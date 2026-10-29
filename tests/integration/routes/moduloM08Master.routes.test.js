process.env.NODE_ENV = process.env.NODE_ENV || 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const app = require('../../../src/app');
const config = require('../../../src/config');
const container = require('../../../src/container');
const RatingsAndClosureUseCase = require('../../../src/application/useCases/ratings/RatingsAndClosureUseCase');

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const CLIENTE_USER = '33333333-3333-4333-8333-333333333333';
const OTRO_CLIENTE = '34343434-3434-4434-8434-343434343434';
const ALIADO_USER = '44444444-4444-4444-8444-444444444444';
const OTRO_ALIADO = '45454545-4545-4454-8454-454545454545';
const ADMIN_USER = '55555555-5555-4555-8555-555555555555';
const SOLICITUD_ID = '66666666-6666-4666-8666-666666666666';
const ALIADO_ID = '77777777-7777-4777-8777-777777777777';
const ALIADO_SIN_VALORAR_ID = '88888888-8888-4888-8888-888888888888';

function token({ role = 'cliente', sub = CLIENTE_USER, tenantId = TENANT_A, secret = config.supabaseJwtSecret, expiresIn = '1h' } = {}) {
  return jwt.sign({ sub, app_metadata: { tenant_id: tenantId, user_role: role } }, secret, { algorithm: 'HS256', expiresIn });
}

function crearRepositorioM08EnMemoria() {
  const solicitudes = new Map([
    [
      SOLICITUD_ID,
      {
        id: SOLICITUD_ID,
        tenantId: TENANT_A,
        estado: 'FINALIZADA',
        clienteUsuarioId: CLIENTE_USER,
        aliadoUsuarioId: ALIADO_USER,
        aliadoId: ALIADO_ID,
        aliadoNombre: 'Aliado Experto SAS',
        categoria: 'Plomería',
        flujoOperativo: 'COTIZACION_PREVIA',
        descripcion: 'Reparación de tubería principal',
        direccion: 'Calle 100 # 15-20',
        zonaDeclarada: { nombre: 'Chapinero', nivel: 'LOCALIDAD', zonaPadre: 'Bogotá' },
        valorCotizado: 120000,
        creadaEn: '2026-10-28T14:00:00.000Z',
        actualizadaEn: '2026-10-28T16:00:00.000Z',
        cerradaEn: null,
        calificacionCliente: null,
        calificacionAliado: null,
      },
    ],
  ]);

  const politicasPorTenant = new Map();

  const construirResumen = (sol) => ({
    calificaciones: {
      clienteAlAliado: sol.calificacionCliente,
      aliadoAlCliente: sol.calificacionAliado,
    },
    cierre: {
      solicitudId: sol.id,
      estadoSolicitud: sol.estado,
      calificacionClienteRegistrada: Boolean(sol.calificacionCliente),
      calificacionAliadoRegistrada: Boolean(sol.calificacionAliado),
      cierreCompleto: Boolean(sol.calificacionCliente && sol.calificacionAliado && sol.estado === 'CERRADA'),
      cerradaEn: sol.cerradaEn,
    },
    reputacionAliado: {
      aliadoId: sol.aliadoId,
      nombreRazonSocial: sol.aliadoNombre,
      calificacionPromedio: sol.calificacionCliente ? sol.calificacionCliente.puntaje : null,
      totalCalificaciones: sol.calificacionCliente ? 1 : 0,
      sinValorar: !sol.calificacionCliente,
      etiquetaCalificacion: sol.calificacionCliente ? `${sol.calificacionCliente.puntaje.toFixed(1)} (1)` : 'Sin valorar',
    },
  });

  const { ConflictError, ForbiddenError, NotFoundError } = require('../../../src/domain/errors/DomainError');

  return {
    registrarCalificacion: async (ctx, { solicitudId, puntaje, comentario }) => {
      const sol = solicitudes.get(solicitudId);
      if (!sol || sol.tenantId !== ctx.tenantId) {
        throw new NotFoundError('MANI-CAL-404: solicitud no encontrada', 'MANI-CAL-404');
      }
      const esCliente = ctx.role === 'CLIENT' && sol.clienteUsuarioId === ctx.userId;
      const esAliado = ctx.role === 'ALLY' && sol.aliadoUsuarioId === ctx.userId;
      if (!esCliente && !esAliado) {
        throw new ForbiddenError(
          'MANI-CAL-403P: solo el cliente titular o el aliado asignado de esta solicitud pueden calificarla',
          'MANI-CAL-403P'
        );
      }
      if (sol.estado !== 'FINALIZADA' && sol.estado !== 'CERRADA') {
        throw new ConflictError('MANI-CAL-409E: solo se puede calificar un servicio finalizado', 'MANI-CAL-409E');
      }
      if (esCliente && sol.calificacionCliente) {
        throw new ConflictError('MANI-CAL-409D: ya registraste tu calificación para este servicio', 'MANI-CAL-409D');
      }
      if (esAliado && sol.calificacionAliado) {
        throw new ConflictError('MANI-CAL-409D: ya registraste tu calificación para este servicio', 'MANI-CAL-409D');
      }
      const cal = {
        id: esCliente ? 'cal-cli-1' : 'cal-ali-1',
        solicitudId,
        autorId: ctx.userId,
        destinatarioId: esCliente ? sol.aliadoUsuarioId : sol.clienteUsuarioId,
        direccion: esCliente ? 'CLIENTE_A_ALIADO' : 'ALIADO_A_CLIENTE',
        puntaje,
        comentario,
        creadaEn: '2026-10-28T17:00:00.000Z',
      };
      if (esCliente) sol.calificacionCliente = cal;
      if (esAliado) sol.calificacionAliado = cal;

      if (sol.calificacionCliente && sol.calificacionAliado) {
        sol.estado = 'CERRADA';
        sol.cerradaEn = '2026-10-28T17:05:00.000Z';
      }
      return { calificacion: cal, ...construirResumen(sol) };
    },

    consultarCalificacionesYCierre: async (ctx, solicitudId) => {
      const sol = solicitudes.get(solicitudId);
      if (!sol || sol.tenantId !== ctx.tenantId) {
        throw new NotFoundError('MANI-CAL-404: solicitud no encontrada', 'MANI-CAL-404');
      }
      const autorizado =
        (ctx.role === 'CLIENT' && sol.clienteUsuarioId === ctx.userId) ||
        (ctx.role === 'ALLY' && sol.aliadoUsuarioId === ctx.userId) ||
        ctx.role === 'ADMIN';
      if (!autorizado) {
        throw new ForbiddenError('MANI-CAL-403P: no eres participante de esta solicitud', 'MANI-CAL-403P');
      }
      return construirResumen(sol);
    },

    cerrarSolicitud: async (ctx, solicitudId) => {
      const sol = solicitudes.get(solicitudId);
      if (!sol || sol.tenantId !== ctx.tenantId) {
        throw new NotFoundError('MANI-CAL-404: solicitud no encontrada', 'MANI-CAL-404');
      }
      if (!sol.calificacionCliente || !sol.calificacionAliado) {
        throw new ConflictError(
          'MANI-CAL-409C: no se declara el cierre completo sin ambas calificaciones',
          'MANI-CAL-409C'
        );
      }
      sol.estado = 'CERRADA';
      sol.cerradaEn = sol.cerradaEn || '2026-10-28T17:05:00.000Z';
      return construirResumen(sol);
    },

    listarReputacionAliados: async (ctx) => {
      if (ctx.tenantId !== TENANT_A) return [];
      const sol = solicitudes.get(SOLICITUD_ID);
      const puntaje = sol.calificacionCliente ? sol.calificacionCliente.puntaje : null;
      return [
        {
          aliadoId: ALIADO_ID,
          nombreRazonSocial: 'Aliado Experto SAS',
          tipo: 'PERSONA_JURIDICA',
          estadoVerificacion: 'VERIFICADO',
          calificacionPromedio: puntaje,
          totalCalificaciones: puntaje ? 1 : 0,
          sinValorar: !puntaje,
          etiquetaCalificacion: puntaje ? `${puntaje.toFixed(1)} (1)` : 'Sin valorar',
        },
        {
          aliadoId: ALIADO_SIN_VALORAR_ID,
          nombreRazonSocial: 'Aliado Nuevo',
          tipo: 'PERSONA_NATURAL',
          estadoVerificacion: 'VERIFICADO',
          calificacionPromedio: null,
          totalCalificaciones: 0,
          sinValorar: true,
          etiquetaCalificacion: 'Sin valorar',
        },
      ];
    },

    obtenerReputacionAliado: async (ctx, aliadoId) => {
      if (ctx.tenantId !== TENANT_A) {
        throw new NotFoundError('MANI-CAL-404A: aliado no encontrado en el tenant', 'MANI-CAL-404A');
      }
      if (aliadoId === ALIADO_SIN_VALORAR_ID) {
        return {
          aliadoId: ALIADO_SIN_VALORAR_ID,
          nombreRazonSocial: 'Aliado Nuevo',
          tipo: 'PERSONA_NATURAL',
          estadoVerificacion: 'VERIFICADO',
          calificacionPromedio: null,
          totalCalificaciones: 0,
          sinValorar: true,
          etiquetaCalificacion: 'Sin valorar',
        };
      }
      if (aliadoId === ALIADO_ID) {
        const sol = solicitudes.get(SOLICITUD_ID);
        const p = sol.calificacionCliente ? sol.calificacionCliente.puntaje : null;
        return {
          aliadoId: ALIADO_ID,
          nombreRazonSocial: 'Aliado Experto SAS',
          tipo: 'PERSONA_JURIDICA',
          estadoVerificacion: 'VERIFICADO',
          calificacionPromedio: p,
          totalCalificaciones: p ? 1 : 0,
          sinValorar: !p,
          etiquetaCalificacion: p ? `${p.toFixed(1)} (1)` : 'Sin valorar',
        };
      }
      throw new NotFoundError('MANI-CAL-404A: aliado no encontrado en el tenant', 'MANI-CAL-404A');
    },

    obtenerPoliticaCancelacion: async (ctx) => {
      return (
        politicasPorTenant.get(ctx.tenantId) || {
          tenantId: ctx.tenantId,
          activa: false,
          ventanaGratuitaMinutos: 15,
          tipoCobro: 'MONTO_FIJO',
          valor: 0,
          estadosGravables: ['ASIGNADA', 'COTIZANDO', 'ACEPTADA'],
          configurada: false,
        }
      );
    },

    configurarPoliticaCancelacion: async (ctx, pol) => {
      const guardada = { tenantId: ctx.tenantId, ...pol, configurada: true };
      politicasPorTenant.set(ctx.tenantId, guardada);
      return guardada;
    },

    previsualizarCancelacion: async (ctx, solicitudId) => {
      const sol = solicitudes.get(solicitudId);
      if (!sol || sol.tenantId !== ctx.tenantId || sol.clienteUsuarioId !== ctx.userId) {
        throw new NotFoundError('MANI-SOL-404: solicitud no encontrada', 'MANI-SOL-404');
      }
      const pol = politicasPorTenant.get(ctx.tenantId);
      if (!pol || !pol.activa || pol.valor <= 0) {
        return {
          solicitudId,
          estadoActual: sol.estado,
          aplicaPenalizacion: false,
          montoPenalizacion: 0,
          moneda: 'COP',
          razon: 'SIN_POLITICA_VIGENTE',
          politicaActiva: false,
        };
      }
      return {
        solicitudId,
        estadoActual: sol.estado,
        aplicaPenalizacion: true,
        montoPenalizacion: pol.valor,
        moneda: 'COP',
        razon: 'CANCELACION_TARDIA_SEGUN_POLITICA',
        politicaActiva: true,
        tipoCobro: pol.tipoCobro,
        valorPolitica: pol.valor,
      };
    },

    listarHistorialCliente: async (ctx, { estado }) => {
      const items = [...solicitudes.values()].filter(
        (s) => s.tenantId === ctx.tenantId && s.clienteUsuarioId === ctx.userId && (!estado || s.estado === estado)
      );
      return items.map((s) => ({
        id: s.id,
        estado: s.estado,
        categoria: s.categoria,
        descripcion: s.descripcion,
        direccion: s.direccion,
        zonaDeclarada: s.zonaDeclarada,
        aliado: { id: s.aliadoId, nombreRazonSocial: s.aliadoNombre },
        calificaciones: {
          clienteAlAliado: s.calificacionCliente,
          aliadoAlCliente: s.calificacionAliado,
          cierreCompleto: Boolean(s.calificacionCliente && s.calificacionAliado && s.estado === 'CERRADA'),
        },
        creadaEn: s.creadaEn,
        actualizadaEn: s.actualizadaEn,
        cerradaEn: s.cerradaEn,
      }));
    },

    listarHistorialAliado: async (ctx, { estado }) => {
      const items = [...solicitudes.values()].filter(
        (s) => s.tenantId === ctx.tenantId && s.aliadoUsuarioId === ctx.userId && (!estado || s.estado === estado)
      );
      return items.map((s) => ({
        id: s.id,
        estado: s.estado,
        categoria: s.categoria,
        descripcion: s.descripcion,
        direccion: s.direccion,
        zonaDeclarada: s.zonaDeclarada,
        valorCotizado: s.valorCotizado,
        calificaciones: {
          aliadoAlCliente: s.calificacionAliado,
          clienteAlAliado: s.calificacionCliente,
          cierreCompleto: Boolean(s.calificacionCliente && s.calificacionAliado && s.estado === 'CERRADA'),
        },
        creadaEn: s.creadaEn,
        actualizadaEn: s.actualizadaEn,
        cerradaEn: s.cerradaEn,
      }));
    },

    obtenerTrabajoAliado: async (ctx, solicitudId) => {
      const sol = solicitudes.get(solicitudId);
      if (!sol || sol.tenantId !== ctx.tenantId || sol.aliadoUsuarioId !== ctx.userId) {
        throw new NotFoundError('MANI-HIS-404: trabajo no encontrado en el historial del aliado', 'MANI-HIS-404');
      }
      return {
        id: sol.id,
        estado: sol.estado,
        categoria: sol.categoria,
        descripcion: sol.descripcion,
        direccion: sol.direccion,
        zonaDeclarada: sol.zonaDeclarada,
        valorCotizado: sol.valorCotizado,
      };
    },
  };
}

function conM08(fn) {
  return async () => {
    const original = container.ratingsAndClosureUseCase;
    const repo = crearRepositorioM08EnMemoria();
    container.ratingsAndClosureUseCase = new RatingsAndClosureUseCase({ ratingsRepository: repo });
    try {
      await fn(repo);
    } finally {
      container.ratingsAndClosureUseCase = original;
    }
  };
}

test(
  'PRUEBA MAESTRO M-08 (SCRUM-874, SCRUM-875, SCRUM-1418, SCRUM-876): calificación bidireccional, cierre condicionado y reputación agregada con aislamiento multi-tenant',
  conM08(async () => {
    // 1. SCRUM-876 C2: antes de recibir calificaciones, ambos aliados figuran o bien 'Sin valorar' (null, nunca 0 ficticio)
    const repInicial = await request(app)
      .get('/api/v1/aliados/calificaciones')
      .set('Authorization', `Bearer ${token({ role: 'cliente' })}`);
    assert.equal(repInicial.status, 200);
    assert.equal(repInicial.body.aliados.length, 2);
    assert.equal(repInicial.body.aliados[0].calificacionPromedio, null);
    assert.equal(repInicial.body.aliados[0].etiquetaCalificacion, 'Sin valorar');
    assert.equal(repInicial.body.aliados[1].calificacionPromedio, null);
    assert.equal(repInicial.body.aliados[1].etiquetaCalificacion, 'Sin valorar');

    // 2. SCRUM-1418 C2: intento de declarar cierre completo sin calificaciones se rechaza con 409 MANI-CAL-409C
    const cierreSinCalificar = await request(app)
      .post(`/api/v1/solicitudes/${SOLICITUD_ID}/cerrar`)
      .set('Authorization', `Bearer ${token({ role: 'cliente' })}`);
    assert.equal(cierreSinCalificar.status, 409);
    assert.equal(cierreSinCalificar.body.code, 'MANI-CAL-409C');

    // 3. SCRUM-874 C2: calificación con puntaje inválido (0 o 6) se rechaza con 422 MANI-CAL-422P
    const puntajeInvalido = await request(app)
      .post(`/api/v1/solicitudes/${SOLICITUD_ID}/calificaciones`)
      .set('Authorization', `Bearer ${token({ role: 'cliente' })}`)
      .send({ puntaje: 6 });
    assert.equal(puntajeInvalido.status, 422);
    assert.equal(puntajeInvalido.body.code, 'MANI-CAL-422P');

    // 4. SCRUM-874 C3: otro cliente del mismo tenant o de otro tenant no puede calificar la solicitud
    const otroClienteMismoTenant = await request(app)
      .post(`/api/v1/solicitudes/${SOLICITUD_ID}/calificaciones`)
      .set('Authorization', `Bearer ${token({ role: 'cliente', sub: OTRO_CLIENTE })}`)
      .send({ puntaje: 5 });
    assert.equal(otroClienteMismoTenant.status, 403);
    assert.equal(otroClienteMismoTenant.body.code, 'MANI-CAL-403P');

    const clienteOtroTenant = await request(app)
      .post(`/api/v1/solicitudes/${SOLICITUD_ID}/calificaciones`)
      .set('Authorization', `Bearer ${token({ role: 'cliente', sub: CLIENTE_USER, tenantId: TENANT_B })}`)
      .send({ puntaje: 5 });
    assert.equal(clienteOtroTenant.status, 404);
    assert.equal(clienteOtroTenant.body.code, 'MANI-CAL-404');

    // 5. SCRUM-874 C1: cliente titular califica al aliado con 5 estrellas
    const calCliente = await request(app)
      .post(`/api/v1/solicitudes/${SOLICITUD_ID}/calificaciones`)
      .set('Authorization', `Bearer ${token({ role: 'cliente' })}`)
      .set('X-Tenant-Id', TENANT_B) // T4: cabecera falsificada ignorada; manda el claim del JWT
      .send({ puntaje: 5, comentario: 'Excelente reparación' });
    assert.equal(calCliente.status, 201);
    assert.equal(calCliente.body.calificacion.direccion, 'CLIENTE_A_ALIADO');
    assert.equal(calCliente.body.calificacion.puntaje, 5);
    // SCRUM-1418 C2: aún falta la calificación del aliado -> cierreCompleto es false y sigue FINALIZADA
    assert.equal(calCliente.body.cierre.calificacionClienteRegistrada, true);
    assert.equal(calCliente.body.cierre.calificacionAliadoRegistrada, false);
    assert.equal(calCliente.body.cierre.cierreCompleto, false);
    assert.equal(calCliente.body.cierre.estadoSolicitud, 'FINALIZADA');

    // 6. SCRUM-874 C2: segundo intento del mismo cliente se rechaza con 409 MANI-CAL-409D
    const calDuplicadaCliente = await request(app)
      .post(`/api/v1/solicitudes/${SOLICITUD_ID}/calificaciones`)
      .set('Authorization', `Bearer ${token({ role: 'cliente' })}`)
      .send({ puntaje: 4 });
    assert.equal(calDuplicadaCliente.status, 409);
    assert.equal(calDuplicadaCliente.body.code, 'MANI-CAL-409D');

    // 7. SCRUM-875 C3: aliado no participante del mismo tenant recibe 403 MANI-CAL-403P
    const aliadoAjeno = await request(app)
      .post(`/api/v1/solicitudes/${SOLICITUD_ID}/calificaciones`)
      .set('Authorization', `Bearer ${token({ role: 'aliado', sub: OTRO_ALIADO })}`)
      .send({ puntaje: 5 });
    assert.equal(aliadoAjeno.status, 403);
    assert.equal(aliadoAjeno.body.code, 'MANI-CAL-403P');

    // 8. SCRUM-875 C1 + SCRUM-1418 C1: aliado asignado califica al cliente -> cierre bidireccional completo (CERRADA)
    const calAliado = await request(app)
      .post(`/api/v1/solicitudes/${SOLICITUD_ID}/calificaciones`)
      .set('Authorization', `Bearer ${token({ role: 'aliado', sub: ALIADO_USER })}`)
      .send({ puntaje: 4, comentario: 'Todo muy claro en el sitio' });
    assert.equal(calAliado.status, 201);
    assert.equal(calAliado.body.calificacion.direccion, 'ALIADO_A_CLIENTE');
    assert.equal(calAliado.body.cierre.calificacionClienteRegistrada, true);
    assert.equal(calAliado.body.cierre.calificacionAliadoRegistrada, true);
    assert.equal(calAliado.body.cierre.cierreCompleto, true);
    assert.equal(calAliado.body.cierre.estadoSolicitud, 'CERRADA');

    // 9. SCRUM-875 C2: calificación duplicada del aliado se rechaza con 409 MANI-CAL-409D
    const calDuplicadaAliado = await request(app)
      .post(`/api/v1/solicitudes/${SOLICITUD_ID}/calificaciones`)
      .set('Authorization', `Bearer ${token({ role: 'aliado', sub: ALIADO_USER })}`)
      .send({ puntaje: 3 });
    assert.equal(calDuplicadaAliado.status, 409);
    assert.equal(calDuplicadaAliado.body.code, 'MANI-CAL-409D');

    // 10. SCRUM-876 C1/C2/C3: el listado muestra 5.0 (1) para el aliado calificado, 'Sin valorar' para el no valorado y vacío en otro tenant
    const repDespues = await request(app)
      .get('/api/v1/aliados/calificaciones')
      .set('Authorization', `Bearer ${token({ role: 'cliente' })}`);
    assert.equal(repDespues.status, 200);
    const calificado = repDespues.body.aliados.find((a) => a.aliadoId === ALIADO_ID);
    const sinValorar = repDespues.body.aliados.find((a) => a.aliadoId === ALIADO_SIN_VALORAR_ID);
    assert.equal(calificado.calificacionPromedio, 5);
    assert.equal(calificado.totalCalificaciones, 1);
    assert.equal(calificado.etiquetaCalificacion, '5.0 (1)');
    assert.equal(sinValorar.calificacionPromedio, null);
    assert.equal(sinValorar.etiquetaCalificacion, 'Sin valorar');

    const repOtroTenant = await request(app)
      .get('/api/v1/aliados/calificaciones')
      .set('Authorization', `Bearer ${token({ role: 'cliente', tenantId: TENANT_B })}`);
    assert.equal(repOtroTenant.status, 200);
    assert.deepEqual(repOtroTenant.body.aliados, []);
  })
);

test(
  'PRUEBA MAESTRO M-08 (SCRUM-878, SCRUM-879, SCRUM-880): penalización por cancelación tardía e historiales de cliente y aliado con aislamiento por tenant',
  conM08(async () => {
    // 1. SCRUM-878 C2: sin política vigente en el tenant, la previsualización informa aplicaPenalizacion = false y monto = 0
    const prevSinPol = await request(app)
      .get(`/api/v1/solicitudes/me/${SOLICITUD_ID}/cancelacion-preview`)
      .set('Authorization', `Bearer ${token({ role: 'cliente' })}`);
    assert.equal(prevSinPol.status, 200);
    assert.equal(prevSinPol.body.penalizacion.aplicaPenalizacion, false);
    assert.equal(prevSinPol.body.penalizacion.montoPenalizacion, 0);
    assert.equal(prevSinPol.body.penalizacion.razon, 'SIN_POLITICA_VIGENTE');

    // 2. SCRUM-878 C1: el admin del tenant A aprueba la política de cancelación tardía (25.000 COP)
    const cfgPol = await request(app)
      .put('/api/v1/tenants/me/politica-cancelacion')
      .set('Authorization', `Bearer ${token({ role: 'admin_tenant', sub: ADMIN_USER, tenantId: TENANT_A })}`)
      .send({ activa: true, ventanaGratuitaMinutos: 15, tipoCobro: 'MONTO_FIJO', valor: 25000 });
    assert.equal(cfgPol.status, 200);
    assert.equal(cfgPol.body.politica.activa, true);
    assert.equal(cfgPol.body.politica.valor, 25000);

    // 3. SCRUM-878 C1: ahora la previsualización en el tenant A calcula y muestra los 25.000 COP
    const prevConPol = await request(app)
      .get(`/api/v1/solicitudes/me/${SOLICITUD_ID}/cancelacion-preview`)
      .set('Authorization', `Bearer ${token({ role: 'cliente' })}`);
    assert.equal(prevConPol.status, 200);
    assert.equal(prevConPol.body.penalizacion.aplicaPenalizacion, true);
    assert.equal(prevConPol.body.penalizacion.montoPenalizacion, 25000);

    // 4. SCRUM-878 C3: la política de TENANT_A no afecta a TENANT_B
    const polTenantB = await request(app)
      .get('/api/v1/tenants/me/politica-cancelacion')
      .set('Authorization', `Bearer ${token({ role: 'cliente', tenantId: TENANT_B })}`);
    assert.equal(polTenantB.status, 200);
    assert.equal(polTenantB.body.politica.activa, false);
    assert.equal(polTenantB.body.politica.valor, 0);

    // 5. SCRUM-879 C1/C2/C3: historial cronológico del cliente (propio vs vacío vs otro tenant)
    const histCliente = await request(app)
      .get('/api/v1/solicitudes/me/historial')
      .set('Authorization', `Bearer ${token({ role: 'cliente', sub: CLIENTE_USER, tenantId: TENANT_A })}`);
    assert.equal(histCliente.status, 200);
    assert.equal(histCliente.body.historial.length, 1);
    assert.equal(histCliente.body.historial[0].id, SOLICITUD_ID);

    const histOtroCliente = await request(app)
      .get('/api/v1/solicitudes/me/historial')
      .set('Authorization', `Bearer ${token({ role: 'cliente', sub: OTRO_CLIENTE, tenantId: TENANT_A })}`);
    assert.equal(histOtroCliente.status, 200);
    assert.deepEqual(histOtroCliente.body.historial, []);
    assert.equal(histOtroCliente.body.totalCount, 0);

    const histClienteOtroTenant = await request(app)
      .get('/api/v1/solicitudes/me/historial')
      .set('Authorization', `Bearer ${token({ role: 'cliente', sub: CLIENTE_USER, tenantId: TENANT_B })}`);
    assert.equal(histClienteOtroTenant.status, 200);
    assert.deepEqual(histClienteOtroTenant.body.historial, []);

    // 6. SCRUM-880 C1/C2/C3: historial de trabajos del aliado asignado (propio vs vacío vs otro aliado/tenant)
    const histAliado = await request(app)
      .get('/api/v1/allies/me/history')
      .set('Authorization', `Bearer ${token({ role: 'aliado', sub: ALIADO_USER, tenantId: TENANT_A })}`);
    assert.equal(histAliado.status, 200);
    assert.equal(histAliado.body.trabajos.length, 1);
    assert.equal(histAliado.body.trabajos[0].id, SOLICITUD_ID);
    assert.equal(histAliado.body.trabajos[0].valorCotizado, 120000);

    const detalleTrabajo = await request(app)
      .get(`/api/v1/allies/me/historial/${SOLICITUD_ID}`)
      .set('Authorization', `Bearer ${token({ role: 'aliado', sub: ALIADO_USER, tenantId: TENANT_A })}`);
    assert.equal(detalleTrabajo.status, 200);
    assert.equal(detalleTrabajo.body.trabajo.id, SOLICITUD_ID);

    // C2: otro aliado sin trabajos asignados recibe lista vacía
    const histOtroAliado = await request(app)
      .get('/api/v1/allies/me/history')
      .set('Authorization', `Bearer ${token({ role: 'aliado', sub: OTRO_ALIADO, tenantId: TENANT_A })}`);
    assert.equal(histOtroAliado.status, 200);
    assert.deepEqual(histOtroAliado.body.trabajos, []);
    assert.equal(histOtroAliado.body.totalCount, 0);

    // C3: otro aliado o aliado de otro tenant no puede ver el detalle de un trabajo ajeno (404 MANI-HIS-404)
    const detalleAjeno = await request(app)
      .get(`/api/v1/allies/me/history/${SOLICITUD_ID}`)
      .set('Authorization', `Bearer ${token({ role: 'aliado', sub: OTRO_ALIADO, tenantId: TENANT_A })}`);
    assert.equal(detalleAjeno.status, 404);
    assert.equal(detalleAjeno.body.code, 'MANI-HIS-404');

    const detalleOtroTenant = await request(app)
      .get(`/api/v1/allies/me/history/${SOLICITUD_ID}`)
      .set('Authorization', `Bearer ${token({ role: 'aliado', sub: ALIADO_USER, tenantId: TENANT_B })}`);
    assert.equal(detalleOtroTenant.status, 404);
    assert.equal(detalleOtroTenant.body.code, 'MANI-HIS-404');
  })
);

test('T2: sin DATABASE_URL los endpoints del Módulo M-08 fallan cerrado con 503', async (t) => {
  if (container.pgPoolFactory.isConfigured()) {
    t.skip('DATABASE_URL está configurada');
    return;
  }
  const resCal = await request(app)
    .post(`/api/v1/solicitudes/${SOLICITUD_ID}/calificaciones`)
    .set('Authorization', `Bearer ${token({ role: 'cliente' })}`)
    .send({ puntaje: 5 });
  assert.equal(resCal.status, 503);

  const resHistCli = await request(app)
    .get('/api/v1/solicitudes/me/historial')
    .set('Authorization', `Bearer ${token({ role: 'cliente' })}`);
  assert.equal(resHistCli.status, 503);

  const resHistAli = await request(app)
    .get('/api/v1/allies/me/history')
    .set('Authorization', `Bearer ${token({ role: 'aliado', sub: ALIADO_USER })}`);
  assert.equal(resHistAli.status, 503);
});
