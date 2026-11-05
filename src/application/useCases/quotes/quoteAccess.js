const { ForbiddenError, UnauthorizedError, ValidationError } = require('../../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Contexto verificado del JWT (T4): tenant, usuario y rol nunca salen del cuerpo ni de cabeceras. */
function contextoDeSesion(user) {
  if (!user || !user.tenantId || !user.userId || !UUID_RE.test(String(user.userId))) {
    throw new UnauthorizedError('MANI-COT-401: sesión requerida', 'MANI-COT-401');
  }
  return { tenantId: user.tenantId, userId: user.userId, role: user.role };
}

function exigirRol(ctx, roles, mensaje) {
  if (!roles.includes(ctx.role)) throw new ForbiddenError(`MANI-COT-403: ${mensaje}`, 'MANI-COT-403');
}

function solicitudIdValido(valor) {
  if (!UUID_RE.test(String(valor || ''))) {
    throw new ValidationError('MANI-COT-400: el id de la solicitud no es válido', 'MANI-COT-400');
  }
  return String(valor);
}

module.exports = { contextoDeSesion, exigirRol, solicitudIdValido };
