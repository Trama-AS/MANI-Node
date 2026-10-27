const { ForbiddenError, UnauthorizedError, ValidationError } = require('../../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_CONTENIDO = 1000;
const LIMITE_POR_OMISION = 50;
const LIMITE_MAXIMO = 100;
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
  constructor({ messageRepository }) {
    if (!messageRepository) throw new Error('messageRepository es requerido para MessagesUseCase');
    this.messageRepository = messageRepository;
  }

  async enviar({ user, solicitudId, body = {} }) {
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

    return this.messageRepository.enviar(ctx, { solicitudId: id, contenido, claveIdempotencia });
  }

  async listar({ user, solicitudId, query = {} }) {
    const ctx = contexto(user);
    const id = uuid(solicitudId, 'el id de la solicitud');

    let limite = LIMITE_POR_OMISION;
    if (query.limite !== undefined) {
      limite = Number(query.limite);
      if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO) {
        throw invalido(`limite debe ser un entero entre 1 y ${LIMITE_MAXIMO}`);
      }
    }
    const despuesDe = query.despuesDe ? uuid(query.despuesDe, 'despuesDe') : null;

    return this.messageRepository.listar(ctx, { solicitudId: id, despuesDe, limite });
  }
}

MessagesUseCase.MAX_CONTENIDO = MAX_CONTENIDO;
module.exports = MessagesUseCase;
