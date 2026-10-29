const { ForbiddenError, UnauthorizedError, ValidationError } = require('../../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CONTENIDO = 1000;
const LIMITE_POR_OMISION = 50;
const LIMITE_MAXIMO = 100;
const MIN_MOTIVO = 5;
const MAX_MOTIVO = 500;
const QUEJA_REF_RE = /^[A-Za-z0-9._:-]{1,100}$/;
// Solo el cliente de la solicitud y el aliado asignado participan. El administrador del tenant consulta una
// conversación solo para atender una queja, con auditoría (SCRUM-883), no por esta vía.
const ROLES_PARTICIPANTES = ['CLIENT', 'ALLY'];

function invalido(mensaje) {
  return new ValidationError(`MANI-MSG-400: ${mensaje}`, 'MANI-MSG-400');
}

function contexto(user) {
  if (!user || !user.tenantId || !user.userId || !UUID_RE.test(String(user.userId))) {
    throw new UnauthorizedError('MANI-MSG-401: sesión requerida', 'MANI-MSG-401');
  }
  if (!ROLES_PARTICIPANTES.includes(user.role)) {
    throw new ForbiddenError('MANI-MSG-403: solo el cliente y el aliado del servicio participan en la mensajería', 'MANI-MSG-403');
  }
  return { tenantId: user.tenantId, userId: user.userId, role: user.role };
}

function contextoAdmin(user) {
  if (!user || !user.tenantId || !user.userId || !UUID_RE.test(String(user.userId))) {
    throw new UnauthorizedError('MANI-MSG-401: sesión requerida', 'MANI-MSG-401');
  }
  // El claim del administrador llega como ADMIN; ADMIN_TENANT se acepta por compatibilidad con el middleware.
  if (user.role !== 'ADMIN' && user.role !== 'ADMIN_TENANT') {
    throw new ForbiddenError(
      'MANI-MSG-403: solo el administrador del tenant consulta una conversación para atender una queja',
      'MANI-MSG-403'
    );
  }
  return { tenantId: user.tenantId, userId: user.userId, role: 'ADMIN' };
}

function limiteDe(query) {
  if (query.limite === undefined) return LIMITE_POR_OMISION;
  const limite = Number(query.limite);
  if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO) {
    throw invalido(`limite debe ser un entero entre 1 y ${LIMITE_MAXIMO}`);
  }
  return limite;
}

function uuid(valor, campo) {
  if (!UUID_RE.test(String(valor || ''))) throw invalido(`${campo} no es un UUID válido`);
  return String(valor);
}

/**
 * Mensajería cliente-aliado por servicio (SCRUM-881, HU-M09-02, RF-20). Los mensajes se guardan en Core, que es el dueño
 * del hilo; el otro participante los recibe consultando el hilo cada pocos segundos (`despuesDe`). Un mensaje solo
 * se da por enviado cuando ya está guardado: si algo falla, no hay entrega exitosa (C2).
 */
class MessagesUseCase {
  constructor({ messageRepository, notificador = null }) {
    if (!messageRepository) throw new Error('messageRepository es requerido para MessagesUseCase');
    this.messageRepository = messageRepository;
    // SCRUM-882: avisa al otro participante. Opcional para poder probar la mensajería sin notificaciones.
    this.notificador = notificador;
  }

  async enviar({ user, solicitudId, body = {}, correlationId }) {
    const ctx = contexto(user);
    const id = uuid(solicitudId, 'el id de la solicitud');

    if (typeof body.contenido !== 'string') throw invalido('contenido es obligatorio y debe ser texto');
    const contenido = body.contenido.trim();
    if (contenido.length < 1 || contenido.length > MAX_CONTENIDO) {
      throw invalido(`el mensaje debe tener entre 1 y ${MAX_CONTENIDO} caracteres`);
    }
    // PostgreSQL no guarda el carácter NUL: sin esta validación sería un 500.
    if (contenido.includes('\u0000')) throw invalido('el mensaje contiene caracteres no permitidos');
    const claveIdempotencia = body.claveIdempotencia ? uuid(body.claveIdempotencia, 'claveIdempotencia') : null;

    const resultado = await this.messageRepository.enviar(ctx, { solicitudId: id, contenido, claveIdempotencia });
    await this.#notificar(ctx, id, resultado.mensaje, correlationId);
    return resultado;
  }

  /**
   * SCRUM-882 (HU-M09-03, RF-20/21): el otro participante recibe una notificación con quién escribió y de qué servicio,
   * sin el texto del mensaje. Se avisa también en un reintento con la misma clave (200): la clave del evento es el id del
   * mensaje, así que si la primera vez no se llegó a notificar se recupera, y si ya se notificó no se duplica.
   * El mensaje ya está guardado: el notificador no lanza y nunca lo revierte.
   */
  async #notificar(ctx, solicitudId, mensaje, correlationId) {
    if (!this.notificador) return;
    await this.notificador.execute(ctx, {
      solicitudId,
      destino: 'CONTRARIO',
      tipo: 'MENSAJE_NUEVO',
      claveEvento: mensaje.id,
      payload: { mensajeId: mensaje.id, remitenteRol: ctx.role },
      correlationId,
    });
  }

  async listar({ user, solicitudId, query = {} }) {
    const ctx = contexto(user);
    const id = uuid(solicitudId, 'el id de la solicitud');

    const limite = limiteDe(query);
    const despuesDe = query.despuesDe ? uuid(query.despuesDe, 'despuesDe') : null;

    return this.messageRepository.listar(ctx, { solicitudId: id, despuesDe, limite });
  }

  /**
   * SCRUM-883 (HU-M09-04, RF-21): el administrador del tenant abre la conversación de un servicio para atender una
   * queja. Debe decir por qué (`motivo`) y puede dar la referencia de la queja (`quejaRef`). Cada consulta queda
   * registrada de forma inmutable en la misma transacción; sin registro no hay conversación. Una conversación sin
   * mensajes responde con lista vacía, no con error.
   */
  async consultarConversacion({ user, solicitudId, body = {}, correlationId }) {
    const ctx = contextoAdmin(user);
    const id = uuid(solicitudId, 'el id de la solicitud');

    if (typeof body.motivo !== 'string') throw invalido('motivo es obligatorio y debe ser texto');
    const motivo = body.motivo.trim();
    if (motivo.length < MIN_MOTIVO || motivo.length > MAX_MOTIVO) {
      throw invalido(`el motivo debe tener entre ${MIN_MOTIVO} y ${MAX_MOTIVO} caracteres`);
    }
    if (motivo.includes('\u0000')) throw invalido('el motivo contiene caracteres no permitidos');

    let quejaRef = null;
    if (body.quejaRef !== undefined && body.quejaRef !== null) {
      if (typeof body.quejaRef !== 'string' || !QUEJA_REF_RE.test(body.quejaRef.trim())) {
        throw invalido('quejaRef debe ser una referencia de 1 a 100 caracteres (letras, números, punto, guion o dos puntos)');
      }
      quejaRef = body.quejaRef.trim();
    }

    return this.messageRepository.consultarConversacion(ctx, {
      solicitudId: id,
      motivo,
      quejaRef,
      limite: limiteDe(body),
      despuesDe: body.despuesDe ? uuid(body.despuesDe, 'despuesDe') : null,
      correlationId,
    });
  }

  /** Quién consultó qué conversación y por qué. Solo el administrador del tenant. */
  async listarConsultas({ user, query = {} }) {
    const ctx = contextoAdmin(user);
    return this.messageRepository.listarConsultas(ctx, {
      limite: limiteDe(query),
      despuesDe: query.despuesDe ? uuid(query.despuesDe, 'despuesDe') : null,
      solicitudId: query.solicitudId ? uuid(query.solicitudId, 'solicitudId') : null,
    });
  }
}

MessagesUseCase.MAX_CONTENIDO = MAX_CONTENIDO;
module.exports = MessagesUseCase;
