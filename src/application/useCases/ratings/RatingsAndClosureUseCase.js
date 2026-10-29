const { DomainError, ForbiddenError, UnauthorizedError, ValidationError } = require('../../../domain/errors/DomainError');
const { entregarAviso } = require('../notifications/entregarAviso');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_COMENTARIO = 500;
const ESTADOS_HISTORIAL_VALIDOS = [
  'PENDIENTE',
  'ASIGNADA',
  'COTIZANDO',
  'ACEPTADA',
  'EN_EJECUCION',
  'FINALIZADA',
  'CERRADA',
  'CANCELADA',
  'RECHAZADA',
];
const ESTADOS_GRAVABLES_PERMITIDOS = ['ASIGNADA', 'COTIZANDO', 'ACEPTADA'];

function sesionVerificada(user, codigoPrefijo = 'MANI-CAL') {
  if (!user || !user.tenantId || !user.userId || !UUID_RE.test(String(user.userId)) || !UUID_RE.test(String(user.tenantId))) {
    throw new UnauthorizedError(`${codigoPrefijo}-401: sesión requerida con tenant y usuario válidos`, `${codigoPrefijo}-401`);
  }
  return { tenantId: String(user.tenantId), userId: String(user.userId), role: user.role };
}

function exigirUuid(valor, nombreCampo, codigo = 'MANI-CAL-400') {
  if (typeof valor !== 'string' || !UUID_RE.test(valor.trim())) {
    throw new ValidationError(`${codigo}: ${nombreCampo} debe ser un UUID válido`, codigo);
  }
  return valor.trim();
}

function validarPuntaje(puntaje) {
  if (puntaje === undefined || puntaje === null || typeof puntaje === 'boolean' || puntaje === '') {
    throw new DomainError('MANI-CAL-422P: el puntaje debe ser un entero entre 1 y 5', 'MANI-CAL-422P', 422);
  }
  const n = Number(puntaje);
  if (!Number.isInteger(n) || n < 1 || n > 5) {
    throw new DomainError('MANI-CAL-422P: el puntaje debe ser un entero entre 1 y 5', 'MANI-CAL-422P', 422);
  }
  return n;
}

function validarComentario(comentario) {
  if (comentario === undefined || comentario === null) return null;
  if (typeof comentario !== 'string') {
    throw new DomainError('MANI-CAL-422C: el comentario debe ser texto', 'MANI-CAL-422C', 422);
  }
  const texto = comentario.trim();
  if (texto.length > MAX_COMENTARIO) {
    throw new DomainError(
      `MANI-CAL-422C: el comentario no puede superar ${MAX_COMENTARIO} caracteres`,
      'MANI-CAL-422C',
      422
    );
  }
  return texto || null;
}

function validarFiltroEstado(estado, codigo = 'MANI-HIS-400') {
  if (estado === undefined || estado === null || String(estado).trim() === '') return null;
  const normalizado = String(estado).trim().toUpperCase();
  if (!ESTADOS_HISTORIAL_VALIDOS.includes(normalizado)) {
    throw new ValidationError(
      `${codigo}: estado debe ser uno de ${ESTADOS_HISTORIAL_VALIDOS.join(', ')}`,
      codigo
    );
  }
  return normalizado;
}

/**
 * Casos de uso del Módulo M-08:
 * - SCRUM-874 (US-04.4.1 / HU-M08-01): Cliente califica al aliado
 * - SCRUM-875 (US-04.4.2 / HU-M08-02): Aliado califica al cliente
 * - SCRUM-1418 (HU-M08-03): Cierre condicionado a la calificación bidireccional
 * - SCRUM-876 (US-04.4.3 / HU-M08-04): Calificación agregada visible en el listado
 * - SCRUM-878 (US-04.5.2 / HU-M08-05): Penalización por cancelación tardía
 * - SCRUM-879 (US-04.6.1 / HU-M08-06): Consultar historial de servicios (Cliente)
 * - SCRUM-880 (US-04.6.2 / HU-M08-07): Aliado consulta historial de trabajos
 */
class RatingsAndClosureUseCase {
  constructor({ ratingsRepository, notificador = null, auditLogger = null }) {
    if (!ratingsRepository) throw new Error('ratingsRepository es requerido para RatingsAndClosureUseCase');
    this.ratingsRepository = ratingsRepository;
    this.notificador = notificador;
    this.auditLogger = auditLogger;
  }

  async calificar({ user, solicitudId, body = {}, correlationId = null }) {
    const ctx = sesionVerificada(user, 'MANI-CAL');
    if (ctx.role !== 'CLIENT' && ctx.role !== 'ALLY') {
      throw new ForbiddenError(
        'MANI-CAL-403: solo el cliente titular o el aliado asignado pueden calificar el servicio',
        'MANI-CAL-403'
      );
    }

    const idValido = exigirUuid(solicitudId, 'el id de la solicitud', 'MANI-CAL-400');
    const puntaje = validarPuntaje(body.puntaje);
    const comentario = validarComentario(body.comentario);

    const { notificacionId, ...resultado } = await this.ratingsRepository.registrarCalificacion(ctx, {
      solicitudId: idValido,
      puntaje,
      comentario,
    });

    await entregarAviso(this.notificador, ctx, notificacionId, correlationId);
    return resultado;
  }

  async consultarCalificacionesYCierre({ user, solicitudId }) {
    const ctx = sesionVerificada(user, 'MANI-CAL');
    if (ctx.role !== 'CLIENT' && ctx.role !== 'ALLY' && ctx.role !== 'ADMIN') {
      throw new ForbiddenError('MANI-CAL-403: rol no autorizado para consultar el cierre del servicio', 'MANI-CAL-403');
    }
    const idValido = exigirUuid(solicitudId, 'el id de la solicitud', 'MANI-CAL-400');
    return this.ratingsRepository.consultarCalificacionesYCierre(ctx, idValido);
  }

  async cerrarSolicitud({ user, solicitudId }) {
    const ctx = sesionVerificada(user, 'MANI-CAL');
    if (ctx.role !== 'CLIENT' && ctx.role !== 'ALLY' && ctx.role !== 'ADMIN') {
      throw new ForbiddenError('MANI-CAL-403: solo los participantes o el administrador del tenant pueden verificar el cierre', 'MANI-CAL-403');
    }
    const idValido = exigirUuid(solicitudId, 'el id de la solicitud', 'MANI-CAL-400');
    return this.ratingsRepository.cerrarSolicitud(ctx, idValido);
  }

  async listarReputacionAliados({ user, query = {} }) {
    const ctx = sesionVerificada(user, 'MANI-CAL');
    const categoriaId = query.categoriaId ? exigirUuid(String(query.categoriaId), 'categoriaId', 'MANI-CAL-400') : null;
    const zonaId = query.zonaId ? exigirUuid(String(query.zonaId), 'zonaId', 'MANI-CAL-400') : null;
    const aliados = await this.ratingsRepository.listarReputacionAliados(ctx, { categoriaId, zonaId });
    return { aliados, totalCount: aliados.length };
  }

  async obtenerReputacionAliado({ user, aliadoId }) {
    const ctx = sesionVerificada(user, 'MANI-CAL');
    const idValido = exigirUuid(aliadoId, 'el id del aliado', 'MANI-CAL-400');
    return this.ratingsRepository.obtenerReputacionAliado(ctx, idValido);
  }

  async obtenerPoliticaCancelacion({ user }) {
    const ctx = sesionVerificada(user, 'MANI-PEN');
    return this.ratingsRepository.obtenerPoliticaCancelacion(ctx);
  }

  async configurarPoliticaCancelacion({ user, body = {}, correlationId = null }) {
    const ctx = sesionVerificada(user, 'MANI-PEN');
    if (ctx.role !== 'ADMIN') {
      throw new ForbiddenError(
        'MANI-PEN-403: solo el administrador del tenant puede configurar la política de cancelación tardía',
        'MANI-PEN-403'
      );
    }

    if (typeof body.activa !== 'boolean') {
      throw new DomainError('MANI-PEN-422: activa debe ser booleano', 'MANI-PEN-422', 422);
    }

    const ventanaGratuitaMinutos = body.ventanaGratuitaMinutos === undefined ? 15 : Number(body.ventanaGratuitaMinutos);
    if (!Number.isInteger(ventanaGratuitaMinutos) || ventanaGratuitaMinutos < 0 || ventanaGratuitaMinutos > 1440) {
      throw new DomainError(
        'MANI-PEN-422: ventanaGratuitaMinutos debe ser un entero entre 0 y 1440',
        'MANI-PEN-422',
        422
      );
    }

    const tipoCobro = body.tipoCobro ? String(body.tipoCobro).trim().toUpperCase() : 'MONTO_FIJO';
    if (tipoCobro !== 'MONTO_FIJO' && tipoCobro !== 'PORCENTAJE') {
      throw new DomainError('MANI-PEN-422: tipoCobro debe ser MONTO_FIJO o PORCENTAJE', 'MANI-PEN-422', 422);
    }

    const valor = body.valor === undefined ? 0 : Number(body.valor);
    if (!Number.isFinite(valor) || valor < 0 || (tipoCobro === 'PORCENTAJE' && valor > 100)) {
      throw new DomainError(
        'MANI-PEN-422: valor debe ser un número no negativo (y hasta 100 si el cobro es PORCENTAJE)',
        'MANI-PEN-422',
        422
      );
    }

    let estadosGravables = ['ASIGNADA', 'COTIZANDO', 'ACEPTADA'];
    if (body.estadosGravables !== undefined) {
      if (!Array.isArray(body.estadosGravables) || body.estadosGravables.length === 0) {
        throw new DomainError('MANI-PEN-422: estadosGravables debe ser una lista no vacía', 'MANI-PEN-422', 422);
      }
      estadosGravables = body.estadosGravables.map((e) => String(e).trim().toUpperCase());
      if (estadosGravables.some((e) => !ESTADOS_GRAVABLES_PERMITIDOS.includes(e))) {
        throw new DomainError(
          `MANI-PEN-422: estadosGravables solo admite ${ESTADOS_GRAVABLES_PERMITIDOS.join(', ')}`,
          'MANI-PEN-422',
          422
        );
      }
    }

    const politica = await this.ratingsRepository.configurarPoliticaCancelacion(ctx, {
      activa: body.activa,
      ventanaGratuitaMinutos,
      tipoCobro,
      valor,
      estadosGravables,
    });

    // T10: auditoría de operaciones administrativas del tenant.
    if (typeof this.auditLogger === 'function') {
      this.auditLogger({
        action: 'CONFIGURE_CANCELLATION_POLICY',
        tenantId: ctx.tenantId,
        actorId: ctx.userId,
        role: ctx.role,
        correlationId: correlationId || 'none',
        politica,
      });
    }

    return politica;
  }

  async previsualizarCancelacion({ user, solicitudId }) {
    const ctx = sesionVerificada(user, 'MANI-SOL');
    if (ctx.role !== 'CLIENT') {
      throw new ForbiddenError('MANI-SOL-403C: solo el cliente titular puede previsualizar la cancelación', 'MANI-SOL-403C');
    }
    const idValido = exigirUuid(solicitudId, 'el id de la solicitud', 'MANI-SOL-400');
    return this.ratingsRepository.previsualizarCancelacion(ctx, idValido);
  }

  async listarHistorialCliente({ user, query = {} }) {
    const ctx = sesionVerificada(user, 'MANI-HIS');
    if (ctx.role !== 'CLIENT') {
      throw new ForbiddenError('MANI-HIS-403C: solo el cliente consulta su historial de servicios', 'MANI-HIS-403C');
    }
    const estado = validarFiltroEstado(query.estado, 'MANI-HIS-400');
    const historial = await this.ratingsRepository.listarHistorialCliente(ctx, { estado });
    return { historial, totalCount: historial.length };
  }

  async listarHistorialAliado({ user, query = {} }) {
    const ctx = sesionVerificada(user, 'MANI-HIS');
    if (ctx.role !== 'ALLY') {
      throw new ForbiddenError('MANI-HIS-403A: solo el aliado consulta su historial de trabajos', 'MANI-HIS-403A');
    }
    const estado = validarFiltroEstado(query.estado, 'MANI-HIS-400');
    const trabajos = await this.ratingsRepository.listarHistorialAliado(ctx, { estado });
    return { trabajos, totalCount: trabajos.length };
  }

  async obtenerTrabajoAliado({ user, solicitudId }) {
    const ctx = sesionVerificada(user, 'MANI-HIS');
    if (ctx.role !== 'ALLY') {
      throw new ForbiddenError('MANI-HIS-403A: solo el aliado consulta el detalle de sus trabajos', 'MANI-HIS-403A');
    }
    const idValido = exigirUuid(solicitudId, 'el id del trabajo', 'MANI-HIS-400');
    return this.ratingsRepository.obtenerTrabajoAliado(ctx, idValido);
  }
}

module.exports = RatingsAndClosureUseCase;
