const { ValidationError } = require('../../../domain/errors/DomainError');
const { contextoDeSesion, exigirRol } = require('./quoteAccess');
const { entregarAviso } = require('../notifications/entregarAviso');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TEXTO = 500;

// Efecto de cada decisión (RF-17, ModeloDatos). Al pedir ajuste la solicitud sigue en COTIZANDO para que el
// aliado emita la siguiente versión (SCRUM-865 lo permite cuando no queda ninguna PENDIENTE).
const DECISIONES = {
  ACEPTAR: { accion: 'ACEPTAR', cotizacion: 'ACEPTADA', solicitud: 'ACEPTADA', evento: 'COTIZACION_ACEPTADA' },
  RECHAZAR: { accion: 'RECHAZAR', cotizacion: 'RECHAZADA', solicitud: 'RECHAZADA', evento: 'COTIZACION_RECHAZADA' },
  AJUSTAR: { accion: 'AJUSTAR', cotizacion: 'AJUSTE_SOLICITADO', solicitud: 'COTIZANDO', evento: 'AJUSTE_SOLICITADO' },
};

// Mínimo de caracteres del texto según la decisión: el rechazo exige motivo y el ajuste exige qué cambiar.
const MINIMO_TEXTO = { ACEPTAR: 0, RECHAZAR: 5, AJUSTAR: 3 };

function invalido(mensaje) {
  return new ValidationError(`MANI-COT-400: ${mensaje}`, 'MANI-COT-400');
}

function textoDe(accion, body) {
  const valor = accion === 'RECHAZAR' ? (body.motivo ?? body.comentario) : body.comentario;
  if (valor !== undefined && valor !== null && typeof valor !== 'string') throw invalido('el texto debe ser una cadena');
  const texto = String(valor ?? '').trim();
  if (texto.length < MINIMO_TEXTO[accion]) {
    throw invalido(
      accion === 'RECHAZAR'
        ? `el motivo del rechazo es obligatorio (mínimo ${MINIMO_TEXTO.RECHAZAR} caracteres)`
        : `el comentario del ajuste es obligatorio (mínimo ${MINIMO_TEXTO.AJUSTAR} caracteres)`
    );
  }
  if (texto.length > MAX_TEXTO) throw invalido(`el texto admite máximo ${MAX_TEXTO} caracteres`);
  return texto;
}

/**
 * US-04.2.3 (SCRUM-867, RF-17): el cliente dueño de la solicitud acepta, rechaza o pide ajustar la cotización
 * pendiente. Core es el dueño del estado tras la asignación (decisión 6A, SAD §7.4): la transición, el evento
 * y la notificación al aliado son atómicos.
 */
class RespondQuoteUseCase {
  constructor({ quoteRepository, notificador = null }) {
    if (!quoteRepository) throw new Error('quoteRepository es requerido');
    this.quoteRepository = quoteRepository;
    // SCRUM-884: el aliado recibe el push de la decisión del cliente. Opcional para probar sin notificaciones.
    this.notificador = notificador;
  }

  async execute({ user, cotizacionId, accion, body = {}, correlationId }) {
    const ctx = contextoDeSesion(user);
    exigirRol(ctx, ['CLIENT'], 'solo el cliente de la solicitud responde la cotización');
    if (!UUID_RE.test(String(cotizacionId || ''))) throw invalido('el id de la cotización no es válido');
    const decision = DECISIONES[accion];
    if (!decision) throw new Error(`Decisión desconocida: ${accion}`);

    const { notificacionId, ...resultado } = await this.quoteRepository.responder(ctx, {
      cotizacionId: String(cotizacionId),
      decision,
      detalle: textoDe(accion, body),
    });
    await entregarAviso(this.notificador, ctx, notificacionId, correlationId);
    return resultado;
  }
}

RespondQuoteUseCase.DECISIONES = DECISIONES;
module.exports = RespondQuoteUseCase;
