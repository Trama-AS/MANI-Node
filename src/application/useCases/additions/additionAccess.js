const { ForbiddenError, UnauthorizedError, ValidationError } = require('../../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalido(mensaje) {
  return new ValidationError(`MANI-ADI-400: ${mensaje}`, 'MANI-ADI-400');
}

/** Contexto verificado del JWT (T4): tenant, usuario y rol nunca salen del cuerpo ni de cabeceras. */
function contextoDeSesion(user) {
  if (!user || !user.tenantId || !user.userId || !UUID_RE.test(String(user.userId))) {
    throw new UnauthorizedError('MANI-ADI-401: sesión requerida', 'MANI-ADI-401');
  }
  return { tenantId: user.tenantId, userId: user.userId, role: user.role };
}

function exigirRol(ctx, roles, mensaje) {
  if (!roles.includes(ctx.role)) throw new ForbiddenError(`MANI-ADI-403: ${mensaje}`, 'MANI-ADI-403');
}

function idValido(valor, que) {
  if (!UUID_RE.test(String(valor || ''))) throw invalido(`el id de la ${que} no es válido`);
  return String(valor);
}

module.exports = { contextoDeSesion, exigirRol, idValido, invalido };
