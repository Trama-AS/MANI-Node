const IRatingsRepository = require('../../domain/ports/IRatingsRepository');
const { ConflictError, ForbiddenError, NotFoundError } = require('../../domain/errors/DomainError');
const { runInTenantContext } = require('../db/runInTenantContext');
const { avisoDeNotificacion } = require('./avisoDeNotificacion');
const { calcularPenalizacionCancelacion } = require('./calculoPenalizacionCancelacion');

const UNIQUE_VIOLATION = '23505';
const MAX_HISTORIAL = 100;

function formatearReputacion(aliadoId, nombreRazonSocial, tipo, estadoVerificacion, total, promedio) {
  const totalNum = Number(total || 0);
  const promNum = totalNum > 0 && promedio !== null && promedio !== undefined ? Number(Number(promedio).toFixed(2)) : null;
  return {
    aliadoId,
    nombreRazonSocial,
    tipo,
    estadoVerificacion,
    calificacionPromedio: promNum,
    totalCalificaciones: totalNum,
    sinValorar: totalNum === 0,
    etiquetaCalificacion: totalNum > 0 ? `${promNum.toFixed(1)} (${totalNum})` : 'Sin valorar',
  };
}

function mapearCalificacion(row, clienteUsuarioId) {
  if (!row) return null;
  return {
    id: row.id,
    solicitudId: row.solicitud_id,
    autorId: row.autor_id,
    destinatarioId: row.destinatario_id,
    direccion: row.autor_id === clienteUsuarioId ? 'CLIENTE_A_ALIADO' : 'ALIADO_A_CLIENTE',
    puntaje: Number(row.puntaje),
    comentario: row.comentario || null,
    creadaEn: row.created_at,
  };
}

async function cargarSolicitudParticipantes(client, tenantId, solicitudId, { bloquear = false } = {}) {
  const lock = bloquear ? 'FOR UPDATE OF s' : '';
  const { rows } = await client.query(
    `SELECT s.id, s.tenant_id, s.estado, s.aliado_id, s.cliente_id, s.cerrada_at,
            cl.usuario_id AS cliente_usuario_id,
            al.usuario_id AS aliado_usuario_id,
            al.nombre_razon_social AS aliado_nombre,
            al.tipo AS aliado_tipo,
            al.estado_verificacion AS aliado_verificacion
     FROM solicitud s
     JOIN cliente cl ON cl.id = s.cliente_id AND cl.tenant_id = s.tenant_id
     LEFT JOIN aliado al ON al.id = s.aliado_id AND al.tenant_id = s.tenant_id
     WHERE s.id = $1 AND s.tenant_id = $2
     ${lock}`,
    [solicitudId, tenantId]
  );
  if (rows.length === 0) {
    throw new NotFoundError('MANI-CAL-404: solicitud no encontrada', 'MANI-CAL-404');
  }
  return rows[0];
}

function verificarAccesoLecturaSolicitud(ctx, sol) {
  const esClienteTitular = ctx.role === 'CLIENT' && sol.cliente_usuario_id === ctx.userId;
  const esAliadoAsignado = ctx.role === 'ALLY' && sol.aliado_usuario_id === ctx.userId;
  const esAdminTenant = ctx.role === 'ADMIN';
  if (!esClienteTitular && !esAliadoAsignado && !esAdminTenant) {
    throw new ForbiddenError(
      'MANI-CAL-403P: solo el cliente titular o el aliado asignado de esta solicitud pueden consultar su cierre y calificaciones',
      'MANI-CAL-403P'
    );
  }
}

async function estadoCalificacionesYCierre(client, tenantId, sol) {
  const { rows } = await client.query(
    `SELECT id, solicitud_id, autor_id, destinatario_id, puntaje, comentario, created_at
     FROM calificacion
     WHERE solicitud_id = $1 AND tenant_id = $2
     ORDER BY created_at ASC`,
    [sol.id, tenantId]
  );

  const filaCliente = rows.find((r) => r.autor_id === sol.cliente_usuario_id) || null;
  const filaAliado = sol.aliado_usuario_id ? rows.find((r) => r.autor_id === sol.aliado_usuario_id) || null : null;

  const calificacionClienteRegistrada = Boolean(filaCliente);
  const calificacionAliadoRegistrada = Boolean(filaAliado);
  const cierreCompleto = calificacionClienteRegistrada && calificacionAliadoRegistrada && sol.estado === 'CERRADA';

  return {
    calificaciones: {
      clienteAlAliado: mapearCalificacion(filaCliente, sol.cliente_usuario_id),
      aliadoAlCliente: mapearCalificacion(filaAliado, sol.cliente_usuario_id),
    },
    cierre: {
      solicitudId: sol.id,
      estadoSolicitud: sol.estado,
      calificacionClienteRegistrada,
      calificacionAliadoRegistrada,
      cierreCompleto,
      cerradaEn: sol.cerrada_at || null,
    },
  };
}

async function consultarReputacionPorUsuario(client, tenantId, aliadoRow) {
  const { rows } = await client.query(
    `SELECT COUNT(c.id)::int AS total,
            CASE WHEN COUNT(c.id) > 0 THEN ROUND(AVG(c.puntaje)::numeric, 2)::float8 ELSE NULL END AS promedio
     FROM calificacion c
     JOIN solicitud s ON s.id = c.solicitud_id AND s.tenant_id = c.tenant_id
     WHERE c.tenant_id = $1
       AND c.destinatario_id = $2
       AND s.estado IN ('FINALIZADA', 'CERRADA')`,
    [tenantId, aliadoRow.aliado_usuario_id || aliadoRow.usuario_id]
  );
  const { total, promedio } = rows[0] || { total: 0, promedio: null };
  return formatearReputacion(
    aliadoRow.aliado_id || aliadoRow.id,
    aliadoRow.aliado_nombre || aliadoRow.nombre_razon_social,
    aliadoRow.aliado_tipo || aliadoRow.tipo,
    aliadoRow.aliado_verificacion || aliadoRow.estado_verificacion,
    total,
    promedio
  );
}

/**
 * Repositorio PostgreSQL del Módulo M-08 bajo runInTenantContext (ADR-0032).
 */
class PgRatingsRepository extends IRatingsRepository {
  constructor({ pgPoolFactory }) {
    super();
    if (!pgPoolFactory) throw new Error('pgPoolFactory es requerido para PgRatingsRepository');
    this.pgPoolFactory = pgPoolFactory;
  }

  /**
   * SCRUM-874 (cliente -> aliado), SCRUM-875 (aliado -> cliente) y SCRUM-1418 (cierre condicionado).
   */
  async registrarCalificacion(ctx, { solicitudId, puntaje, comentario }) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const sol = await cargarSolicitudParticipantes(client, ctx.tenantId, solicitudId, { bloquear: true });

      const esClienteTitular = ctx.role === 'CLIENT' && sol.cliente_usuario_id === ctx.userId;
      const esAliadoAsignado = ctx.role === 'ALLY' && sol.aliado_usuario_id === ctx.userId;

      if (!esClienteTitular && !esAliadoAsignado) {
        throw new ForbiddenError(
          'MANI-CAL-403P: solo el cliente titular o el aliado asignado de esta solicitud pueden calificarla',
          'MANI-CAL-403P'
        );
      }

      if (sol.estado !== 'FINALIZADA' && sol.estado !== 'CERRADA') {
        throw new ConflictError(
          `MANI-CAL-409E: la solicitud en estado ${sol.estado} no puede calificarse; requiere que la ejecución haya finalizado`,
          'MANI-CAL-409E'
        );
      }

      if (!sol.aliado_usuario_id) {
        throw new ConflictError('MANI-CAL-409A: la solicitud no tiene aliado asignado para calificar', 'MANI-CAL-409A');
      }

      const autorId = ctx.userId;
      const destinatarioId = esClienteTitular ? sol.aliado_usuario_id : sol.cliente_usuario_id;
      const tipoEvento = esClienteTitular ? 'CALIFICACION_CLIENTE' : 'CALIFICACION_ALIADO';

      const previa = await client.query(
        'SELECT id FROM calificacion WHERE tenant_id = $1 AND solicitud_id = $2 AND autor_id = $3',
        [ctx.tenantId, solicitudId, autorId]
      );
      if (previa.rows.length > 0) {
        throw new ConflictError('MANI-CAL-409D: ya registraste tu calificación para este servicio', 'MANI-CAL-409D');
      }

      let insertada;
      try {
        insertada = await client.query(
          `INSERT INTO calificacion (tenant_id, solicitud_id, autor_id, destinatario_id, puntaje, comentario)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING id, solicitud_id, autor_id, destinatario_id, puntaje, comentario, created_at`,
          [ctx.tenantId, solicitudId, autorId, destinatarioId, puntaje, comentario || null]
        );
      } catch (err) {
        if (err.code === UNIQUE_VIOLATION) {
          throw new ConflictError('MANI-CAL-409D: ya registraste tu calificación para este servicio', 'MANI-CAL-409D');
        }
        throw err;
      }

      await client.query(
        `INSERT INTO evento_servicio (tenant_id, solicitud_id, actor_id, tipo_evento, descripcion)
         VALUES ($1, $2, $3, $4, $5)`,
        [ctx.tenantId, solicitudId, autorId, tipoEvento, `Calificación registrada (${puntaje}/5).`]
      );

      // SCRUM-1418: comprobar si ya están las dos calificaciones (cliente -> aliado y aliado -> cliente).
      const conteo = await client.query(
        `SELECT autor_id FROM calificacion
         WHERE tenant_id = $1 AND solicitud_id = $2 AND autor_id IN ($3, $4)`,
        [ctx.tenantId, solicitudId, sol.cliente_usuario_id, sol.aliado_usuario_id]
      );
      const autores = new Set(conteo.rows.map((r) => r.autor_id));
      const ambasPresentes = autores.has(sol.cliente_usuario_id) && autores.has(sol.aliado_usuario_id);

      let aviso = {};
      if (ambasPresentes && sol.estado !== 'CERRADA') {
        const cierreUpd = await client.query(
          `UPDATE solicitud
           SET estado = 'CERRADA', cerrada_at = COALESCE(cerrada_at, now()), updated_at = now()
           WHERE id = $1 AND tenant_id = $2
           RETURNING estado, cerrada_at`,
          [solicitudId, ctx.tenantId]
        );
        sol.estado = cierreUpd.rows[0].estado;
        sol.cerrada_at = cierreUpd.rows[0].cerrada_at;

        await client.query(
          `INSERT INTO evento_servicio (tenant_id, solicitud_id, actor_id, tipo_evento, descripcion)
           VALUES ($1, $2, $3, 'SERVICIO_CERRADO', 'Servicio cerrado tras completarse la calificación bidireccional.')`,
          [ctx.tenantId, solicitudId, autorId]
        );

        aviso = avisoDeNotificacion(
          await client.query(
            `INSERT INTO notificacion (tenant_id, usuario_id, tipo, canal, payload)
             VALUES ($1, $2, 'SERVICIO_CERRADO', 'PUSH', $3::jsonb)
             RETURNING id`,
            [ctx.tenantId, destinatarioId, JSON.stringify({ requestId: solicitudId, estado: 'CERRADA' })]
          )
        );
      }

      const resumen = await estadoCalificacionesYCierre(client, ctx.tenantId, sol);
      const reputacionAliado = await consultarReputacionPorUsuario(client, ctx.tenantId, sol);

      return {
        calificacion: mapearCalificacion(insertada.rows[0], sol.cliente_usuario_id),
        ...resumen,
        reputacionAliado,
        ...aviso,
      };
    });
  }

  async consultarCalificacionesYCierre(ctx, solicitudId) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const sol = await cargarSolicitudParticipantes(client, ctx.tenantId, solicitudId);
      verificarAccesoLecturaSolicitud(ctx, sol);
      const resumen = await estadoCalificacionesYCierre(client, ctx.tenantId, sol);
      const reputacionAliado = sol.aliado_id ? await consultarReputacionPorUsuario(client, ctx.tenantId, sol) : null;
      return {
        ...resumen,
        reputacionAliado,
      };
    });
  }

  /**
   * SCRUM-1418 (C1/C2/C3): Cierre explícito condicionado a calificación bidireccional.
   * Rechaza con 409 si falta cualquiera de las dos calificaciones o si el servicio aún no ha finalizado.
   */
  async cerrarSolicitud(ctx, solicitudId) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const sol = await cargarSolicitudParticipantes(client, ctx.tenantId, solicitudId, { bloquear: true });
      verificarAccesoLecturaSolicitud(ctx, sol);

      if (sol.estado !== 'FINALIZADA' && sol.estado !== 'CERRADA') {
        throw new ConflictError(
          `MANI-CAL-409E: la solicitud en estado ${sol.estado} no puede cerrarse; primero debe finalizar su ejecución`,
          'MANI-CAL-409E'
        );
      }

      const resumenPrevio = await estadoCalificacionesYCierre(client, ctx.tenantId, sol);
      if (!resumenPrevio.cierre.calificacionClienteRegistrada || !resumenPrevio.cierre.calificacionAliadoRegistrada) {
        const faltantes = [];
        if (!resumenPrevio.cierre.calificacionClienteRegistrada) faltantes.push('cliente -> aliado');
        if (!resumenPrevio.cierre.calificacionAliadoRegistrada) faltantes.push('aliado -> cliente');
        throw new ConflictError(
          `MANI-CAL-409C: no se declara el cierre completo sin ambas calificaciones (falta: ${faltantes.join(', ')})`,
          'MANI-CAL-409C'
        );
      }

      if (sol.estado !== 'CERRADA') {
        const upd = await client.query(
          `UPDATE solicitud
           SET estado = 'CERRADA', cerrada_at = COALESCE(cerrada_at, now()), updated_at = now()
           WHERE id = $1 AND tenant_id = $2
           RETURNING estado, cerrada_at`,
          [solicitudId, ctx.tenantId]
        );
        sol.estado = upd.rows[0].estado;
        sol.cerrada_at = upd.rows[0].cerrada_at;

        await client.query(
          `INSERT INTO evento_servicio (tenant_id, solicitud_id, actor_id, tipo_evento, descripcion)
           VALUES ($1, $2, $3, 'SERVICIO_CERRADO', 'Servicio cerrado tras verificar calificación bidireccional.')`,
          [ctx.tenantId, solicitudId, ctx.userId]
        );
      }

      return estadoCalificacionesYCierre(client, ctx.tenantId, sol);
    });
  }

  /**
   * SCRUM-876 (C1/C2/C3): Listado de aliados del tenant con su calificación agregada.
   * Si un aliado no tiene calificaciones recibidas en servicios FINALIZADA/CERRADA de su tenant,
   * devuelve calificacionPromedio = null y etiquetaCalificacion = 'Sin valorar' (nunca 0 ficticio).
   */
  async listarReputacionAliados(ctx, { categoriaId = null, zonaId = null } = {}) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT a.id, a.nombre_razon_social, a.tipo, a.estado_verificacion,
                COUNT(c.id)::int AS total_calificaciones,
                CASE WHEN COUNT(c.id) > 0 THEN ROUND(AVG(c.puntaje)::numeric, 2)::float8 ELSE NULL END AS calificacion_promedio
         FROM aliado a
         JOIN usuario u ON u.id = a.usuario_id AND u.tenant_id = a.tenant_id AND u.estado = 'ACTIVO'
         LEFT JOIN (
           SELECT cal.id, cal.destinatario_id, cal.tenant_id, cal.puntaje
           FROM calificacion cal
           JOIN solicitud s ON s.id = cal.solicitud_id AND s.tenant_id = cal.tenant_id
           WHERE cal.tenant_id = $1 AND s.estado IN ('FINALIZADA', 'CERRADA')
         ) c ON c.destinatario_id = a.usuario_id AND c.tenant_id = a.tenant_id
         WHERE a.tenant_id = $1
           AND a.estado_verificacion = 'VERIFICADO'
           AND ($2::uuid IS NULL OR EXISTS (
             SELECT 1 FROM aliado_categoria ac
             WHERE ac.aliado_id = a.id AND ac.tenant_id = a.tenant_id AND ac.categoria_id = $2::uuid
           ))
           AND ($3::uuid IS NULL OR EXISTS (
             SELECT 1 FROM cobertura_aliado ca
             WHERE ca.aliado_id = a.id AND ca.tenant_id = a.tenant_id AND ca.zona_id = $3::uuid
           ))
         GROUP BY a.id, a.nombre_razon_social, a.tipo, a.estado_verificacion
         ORDER BY
           CASE WHEN COUNT(c.id) > 0 THEN 0 ELSE 1 END ASC,
           AVG(c.puntaje) DESC NULLS LAST,
           a.nombre_razon_social ASC`,
        [ctx.tenantId, categoriaId, zonaId]
      );

      return rows.map((r) =>
        formatearReputacion(
          r.id,
          r.nombre_razon_social,
          r.tipo,
          r.estado_verificacion,
          r.total_calificaciones,
          r.calificacion_promedio
        )
      );
    });
  }

  async obtenerReputacionAliado(ctx, aliadoId) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT a.id, a.usuario_id, a.nombre_razon_social, a.tipo, a.estado_verificacion
         FROM aliado a
         WHERE a.id = $1 AND a.tenant_id = $2`,
        [aliadoId, ctx.tenantId]
      );
      if (rows.length === 0) {
        throw new NotFoundError('MANI-CAL-404A: aliado no encontrado en el tenant', 'MANI-CAL-404A');
      }
      return consultarReputacionPorUsuario(client, ctx.tenantId, rows[0]);
    });
  }

  /**
   * SCRUM-878: consulta y configuración de la política de cancelación tardía del tenant.
   */
  async obtenerPoliticaCancelacion(ctx) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT tenant_id, activa, ventana_gratuita_minutos, tipo_cobro, valor, estados_gravables, updated_at
         FROM politica_cancelacion_tenant
         WHERE tenant_id = $1`,
        [ctx.tenantId]
      );
      if (rows.length === 0) {
        return {
          tenantId: ctx.tenantId,
          activa: false,
          ventanaGratuitaMinutos: 15,
          tipoCobro: 'MONTO_FIJO',
          valor: 0,
          estadosGravables: ['ASIGNADA', 'COTIZANDO', 'ACEPTADA'],
          configurada: false,
        };
      }
      const r = rows[0];
      return {
        tenantId: r.tenant_id,
        activa: Boolean(r.activa),
        ventanaGratuitaMinutos: Number(r.ventana_gratuita_minutos),
        tipoCobro: r.tipo_cobro,
        valor: Number(r.valor),
        estadosGravables: r.estados_gravables,
        actualizadaEn: r.updated_at,
        configurada: true,
      };
    });
  }

  async configurarPoliticaCancelacion(ctx, politica) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO politica_cancelacion_tenant (
           tenant_id, activa, ventana_gratuita_minutos, tipo_cobro, valor, estados_gravables, updated_by, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, now())
         ON CONFLICT (tenant_id) DO UPDATE SET
           activa = EXCLUDED.activa,
           ventana_gratuita_minutos = EXCLUDED.ventana_gratuita_minutos,
           tipo_cobro = EXCLUDED.tipo_cobro,
           valor = EXCLUDED.valor,
           estados_gravables = EXCLUDED.estados_gravables,
           updated_by = EXCLUDED.updated_by,
           updated_at = now()
         RETURNING tenant_id, activa, ventana_gratuita_minutos, tipo_cobro, valor, estados_gravables, updated_at`,
        [
          ctx.tenantId,
          politica.activa,
          politica.ventanaGratuitaMinutos,
          politica.tipoCobro,
          politica.valor,
          politica.estadosGravables,
          ctx.userId,
        ]
      );
      const r = rows[0];
      return {
        tenantId: r.tenant_id,
        activa: Boolean(r.activa),
        ventanaGratuitaMinutos: Number(r.ventana_gratuita_minutos),
        tipoCobro: r.tipo_cobro,
        valor: Number(r.valor),
        estadosGravables: r.estados_gravables,
        actualizadaEn: r.updated_at,
        configurada: true,
      };
    });
  }

  /**
   * SCRUM-878: previsualiza la penalización por cancelación tardía antes de confirmar la cancelación.
   */
  async previsualizarCancelacion(ctx, solicitudId) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT s.id, s.estado, s.aliado_id, s.created_at, s.updated_at,
                s.penalizacion_aplicada, s.penalizacion_monto, s.penalizacion_motivo
         FROM solicitud s
         JOIN cliente cl ON cl.id = s.cliente_id AND cl.tenant_id = s.tenant_id
         WHERE cl.usuario_id = $1 AND s.tenant_id = $2 AND s.id = $3`,
        [ctx.userId, ctx.tenantId, solicitudId]
      );
      if (rows.length === 0) {
        throw new NotFoundError('MANI-SOL-404: solicitud no encontrada', 'MANI-SOL-404');
      }
      const sol = rows[0];
      if (sol.estado === 'CANCELADA') {
        return {
          solicitudId: sol.id,
          estadoActual: sol.estado,
          aplicaPenalizacion: Boolean(sol.penalizacion_aplicada),
          montoPenalizacion: Number(sol.penalizacion_monto || 0),
          moneda: 'COP',
          razon: sol.penalizacion_motivo || 'YA_CANCELADA',
          politicaActiva: Boolean(sol.penalizacion_aplicada),
        };
      }
      return calcularPenalizacionCancelacion(client, ctx.tenantId, sol);
    });
  }

  /**
   * SCRUM-879 (C1/C2/C3): Historial cronológico de servicios del cliente titular.
   */
  async listarHistorialCliente(ctx, { estado = null } = {}) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const { rows } = await client.query(
        `SELECT s.id, s.estado, c.nombre AS categoria, c.flujo_operativo, s.descripcion,
                si.direccion, z.nombre AS zona, z.nivel AS zona_nivel, zp.nombre AS zona_padre,
                al.id AS aliado_id, al.nombre_razon_social AS aliado_nombre,
                s.penalizacion_aplicada, s.penalizacion_monto, s.penalizacion_motivo,
                s.created_at, s.updated_at, s.cerrada_at,
                cal_cli.puntaje AS puntaje_emitido, cal_cli.comentario AS comentario_emitido,
                cal_ali.puntaje AS puntaje_recibido, cal_ali.comentario AS comentario_recibido
         FROM solicitud s
         JOIN cliente cl ON cl.id = s.cliente_id AND cl.tenant_id = s.tenant_id
         JOIN categoria_servicio c ON c.id = s.categoria_id AND c.tenant_id = s.tenant_id
         JOIN sitio si ON si.id = s.sitio_id AND si.tenant_id = s.tenant_id
         JOIN zona z ON z.id = s.zona_id
         LEFT JOIN zona zp ON zp.id = z.zona_padre_id
         LEFT JOIN aliado al ON al.id = s.aliado_id AND al.tenant_id = s.tenant_id
         LEFT JOIN calificacion cal_cli
           ON cal_cli.solicitud_id = s.id AND cal_cli.tenant_id = s.tenant_id AND cal_cli.autor_id = cl.usuario_id
         LEFT JOIN calificacion cal_ali
           ON cal_ali.solicitud_id = s.id AND cal_ali.tenant_id = s.tenant_id AND cal_ali.autor_id = al.usuario_id
         WHERE cl.usuario_id = $1
           AND s.tenant_id = $2
           AND ($3::text IS NULL OR s.estado = $3::text)
         ORDER BY s.created_at DESC, s.id DESC
         LIMIT ${MAX_HISTORIAL}`,
        [ctx.userId, ctx.tenantId, estado]
      );

      return rows.map((r) => ({
        id: r.id,
        estado: r.estado,
        categoria: r.categoria,
        flujoOperativo: r.flujo_operativo,
        descripcion: r.descripcion,
        direccion: r.direccion,
        zonaDeclarada: { nombre: r.zona, nivel: r.zona_nivel, zonaPadre: r.zona_padre },
        aliado: r.aliado_id ? { id: r.aliado_id, nombreRazonSocial: r.aliado_nombre } : null,
        penalizacion: {
          aplicada: Boolean(r.penalizacion_aplicada),
          monto: Number(r.penalizacion_monto || 0),
          motivo: r.penalizacion_motivo || null,
        },
        calificaciones: {
          clienteAlAliado: r.puntaje_emitido !== null && r.puntaje_emitido !== undefined
            ? { puntaje: Number(r.puntaje_emitido), comentario: r.comentario_emitido || null }
            : null,
          aliadoAlCliente: r.puntaje_recibido !== null && r.puntaje_recibido !== undefined
            ? { puntaje: Number(r.puntaje_recibido), comentario: r.comentario_recibido || null }
            : null,
          cierreCompleto: r.estado === 'CERRADA' && r.puntaje_emitido !== null && r.puntaje_recibido !== null,
        },
        creadaEn: r.created_at,
        actualizadaEn: r.updated_at,
        cerradaEn: r.cerrada_at || null,
      }));
    });
  }

  /**
   * SCRUM-880 (C1/C2/C3): Historial cronológico de trabajos donde el aliado de la sesión fue asignado.
   */
  async listarHistorialAliado(ctx, { estado = null } = {}) {
    return runInTenantContext(this.pgPoolFactory, ctx, async (client) => {
      const aliado = await client.query(
        'SELECT id, usuario_id FROM aliado WHERE usuario_id = $1 AND tenant_id = $2',
        [ctx.userId, ctx.tenantId]
      );
      if (aliado.rows.length === 0) {
        throw new ForbiddenError('MANI-HIS-403A: solo un aliado del tenant puede consultar su historial de trabajos', 'MANI-HIS-403A');
      }
      const aliadoId = aliado.rows[0].id;

      const { rows } = await client.query(
        `SELECT s.id, s.estado, c.nombre AS categoria, c.flujo_operativo, s.descripcion,
                si.direccion, z.nombre AS zona, z.nivel AS zona_nivel, zp.nombre AS zona_padre,
                s.created_at, s.updated_at, s.cerrada_at,
                s.penalizacion_aplicada, s.penalizacion_monto,
                cal_ali.puntaje AS puntaje_al_cliente, cal_ali.comentario AS comentario_al_cliente,
                cal_cli.puntaje AS puntaje_del_cliente, cal_cli.comentario AS comentario_del_cliente,
                (SELECT ev.timestamp FROM evento_servicio ev
                 WHERE ev.solicitud_id = s.id AND ev.tenant_id = s.tenant_id AND ev.tipo_evento = 'INICIO_EJECUCION'
                 ORDER BY ev.timestamp DESC LIMIT 1) AS inicio_ejecucion_at,
                (SELECT ev.timestamp FROM evento_servicio ev
                 WHERE ev.solicitud_id = s.id AND ev.tenant_id = s.tenant_id AND ev.tipo_evento = 'FIN_EJECUCION'
                 ORDER BY ev.timestamp DESC LIMIT 1) AS fin_ejecucion_at,
                (SELECT (cot.valor_mano_obra + cot.valor_materiales)::float8 FROM cotizacion cot
                 WHERE cot.solicitud_id = s.id AND cot.tenant_id = s.tenant_id AND cot.estado = 'ACEPTADA'
                 ORDER BY cot.version DESC LIMIT 1) AS valor_cotizado
         FROM solicitud s
         JOIN cliente cl ON cl.id = s.cliente_id AND cl.tenant_id = s.tenant_id
         JOIN categoria_servicio c ON c.id = s.categoria_id AND c.tenant_id = s.tenant_id
         JOIN sitio si ON si.id = s.sitio_id AND si.tenant_id = s.tenant_id
         JOIN zona z ON z.id = s.zona_id
         LEFT JOIN zona zp ON zp.id = z.zona_padre_id
         LEFT JOIN calificacion cal_ali
           ON cal_ali.solicitud_id = s.id AND cal_ali.tenant_id = s.tenant_id AND cal_ali.autor_id = $1
         LEFT JOIN calificacion cal_cli
           ON cal_cli.solicitud_id = s.id AND cal_cli.tenant_id = s.tenant_id AND cal_cli.autor_id = cl.usuario_id
         WHERE s.tenant_id = $2
           AND s.aliado_id = $3
           AND ($4::text IS NULL OR s.estado = $4::text)
         ORDER BY s.created_at DESC, s.id DESC
         LIMIT ${MAX_HISTORIAL}`,
        [ctx.userId, ctx.tenantId, aliadoId, estado]
      );

      return rows.map((r) => ({
        id: r.id,
        estado: r.estado,
        categoria: r.categoria,
        flujoOperativo: r.flujo_operativo,
        descripcion: r.descripcion,
        direccion: r.direccion,
        zonaDeclarada: { nombre: r.zona, nivel: r.zona_nivel, zonaPadre: r.zona_padre },
        valorCotizado: r.valor_cotizado !== null && r.valor_cotizado !== undefined ? Number(r.valor_cotizado) : null,
        penalizacionCancelacion: {
          aplicada: Boolean(r.penalizacion_aplicada),
          monto: Number(r.penalizacion_monto || 0),
        },
        calificaciones: {
          aliadoAlCliente: r.puntaje_al_cliente !== null && r.puntaje_al_cliente !== undefined
            ? { puntaje: Number(r.puntaje_al_cliente), comentario: r.comentario_al_cliente || null }
            : null,
          clienteAlAliado: r.puntaje_del_cliente !== null && r.puntaje_del_cliente !== undefined
            ? { puntaje: Number(r.puntaje_del_cliente), comentario: r.comentario_del_cliente || null }
            : null,
          cierreCompleto: r.estado === 'CERRADA' && r.puntaje_al_cliente !== null && r.puntaje_del_cliente !== null,
        },
        creadaEn: r.created_at,
        actualizadaEn: r.updated_at,
        inicioEjecucionEn: r.inicio_ejecucion_at || null,
        finEjecucionEn: r.fin_ejecucion_at || null,
        cerradaEn: r.cerrada_at || null,
      }));
    });
  }

  async obtenerTrabajoAliado(ctx, solicitudId) {
    const lista = await this.listarHistorialAliado(ctx, {});
    const trabajo = lista.find((item) => item.id === solicitudId);
    if (!trabajo) {
      throw new NotFoundError('MANI-HIS-404: trabajo no encontrado en el historial del aliado', 'MANI-HIS-404');
    }
    return trabajo;
  }
}

module.exports = PgRatingsRepository;
