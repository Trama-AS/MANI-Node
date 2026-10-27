const { ForbiddenError, UnauthorizedError, ValidationError } = require('../../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_OBSERVACION = 500;

function contexto(user) {
  if (!user || !user.tenantId || !user.userId || !UUID_RE.test(String(user.userId))) {
    throw new UnauthorizedError('MANI-EJE-401: sesión requerida', 'MANI-EJE-401');
  }
  return { tenantId: user.tenantId, userId: user.userId, role: user.role };
}

function solicitudIdValido(valor) {
  if (!UUID_RE.test(String(valor || ''))) {
    throw new ValidationError('MANI-EJE-400: el id de la solicitud no es válido', 'MANI-EJE-400');
  }
  return String(valor);
}

function observacionDe(body) {
  const valor = body.observacion;
  if (valor === undefined || valor === null) return '';
  if (typeof valor !== 'string') {
    throw new ValidationError('MANI-EJE-400: la observación debe ser texto', 'MANI-EJE-400');
  }
  const texto = valor.trim();
  if (texto.length > MAX_OBSERVACION) {
    throw new ValidationError(`MANI-EJE-400: la observación admite máximo ${MAX_OBSERVACION} caracteres`, 'MANI-EJE-400');
  }
  return texto;
}

/**
 * US-04.3.1 (SCRUM-868, RF-18): el aliado asignado marca el inicio y el fin de la ejecución, y el cliente dueño y
 * ese aliado consultan las marcas. Las horas las pone el servidor; la app no envía fechas.
 */
class ServiceExecutionUseCase {
  constructor({ serviceExecutionRepository }) {
    if (!serviceExecutionRepository) throw new Error('serviceExecutionRepository es requerido');
    this.serviceExecutionRepository = serviceExecutionRepository;
  }

  async marcar({ user, solicitudId, hito, body = {} }) {
    const ctx = contexto(user);
    if (ctx.role !== 'ALLY') {
      throw new ForbiddenError('MANI-EJE-403: solo el aliado asignado marca la ejecución', 'MANI-EJE-403');
    }
    if (hito !== 'INICIO' && hito !== 'FIN') throw new Error(`Hito desconocido: ${hito}`);
    return this.serviceExecutionRepository.marcar(ctx, {
      solicitudId: solicitudIdValido(solicitudId),
      hito,
      observacion: observacionDe(body),
    });
  }

  async consultar({ user, solicitudId }) {
    const ctx = contexto(user);
    if (ctx.role !== 'ALLY' && ctx.role !== 'CLIENT') {
      throw new ForbiddenError('MANI-EJE-403: solo el cliente dueño o el aliado asignado consultan la ejecución', 'MANI-EJE-403');
    }
    return this.serviceExecutionRepository.consultar(ctx, solicitudIdValido(solicitudId));
  }
}

module.exports = ServiceExecutionUseCase;
