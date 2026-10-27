const { ForbiddenError, UnauthorizedError, ValidationError } = require('../../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Contexto verificado del JWT (T4): tenant, usuario y rol nunca salen del cuerpo ni de cabeceras. */
function contextoDeSesion(user) {
  if (!user || !user.tenantId || !user.userId || !UUID_RE.test(String(user.userId))) {
    throw new UnauthorizedError('MANI-PAG-401: sesión requerida', 'MANI-PAG-401');
  }
  if (user.role !== 'CLIENT') {
    throw new ForbiddenError('MANI-PAG-403: solo el cliente realiza y consulta sus pagos', 'MANI-PAG-403');
  }
  return { tenantId: user.tenantId, userId: user.userId, role: user.role };
}

function uuidValido(valor, campo) {
  if (!UUID_RE.test(String(valor || ''))) {
    throw new ValidationError(`MANI-PAG-400: ${campo} no es un UUID válido`, 'MANI-PAG-400');
  }
  return String(valor);
}

module.exports = { contextoDeSesion, uuidValido, UUID_RE };
