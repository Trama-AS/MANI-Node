const { ForbiddenError, UnauthorizedError } = require('../../../domain/errors/DomainError');
const { UUID_RE, contextoDeSesion, uuidValido } = require('./paymentAccess');

function contextoDeRol(user, rol, mensaje, codigo) {
  if (!user || !user.tenantId || !user.userId || !UUID_RE.test(String(user.userId))) {
    throw new UnauthorizedError('MANI-FON-401: sesión requerida', 'MANI-FON-401');
  }
  if (user.role !== rol) throw new ForbiddenError(`${codigo}: ${mensaje}`, codigo);
  return { tenantId: user.tenantId, userId: user.userId, role: user.role };
}

/**
 * Retención en garantía, cobros del aliado y comisión por tenant (SCRUM-891 a 894). Todo simulado: el sandbox no mueve
 * dinero real. Tenant, usuario y rol salen del JWT.
 */
class FundsUseCase {
  constructor({ fondosRepository }) {
    if (!fondosRepository) throw new Error('fondosRepository es requerido para FundsUseCase');
    this.fondosRepository = fondosRepository;
  }

  /** Retención del pago, para el cliente que pagó (891). */
  async retencion({ user, pagoId }) {
    return this.fondosRepository.retencionDelPago(contextoDeSesion(user), uuidValido(pagoId, 'el id del pago'));
  }

  /** Cobros del aliado de la sesión (894): vacío si aún no tiene movimientos. */
  async cobrosDelAliado({ user }) {
    const ctx = contextoDeRol(user, 'ALLY', 'solo un aliado consulta sus cobros', 'MANI-FON-403');
    const cobros = await this.fondosRepository.cobrosDelAliado(ctx);
    return { cobros, simulado: true };
  }

  /** Comisión vigente del tenant, para su administrador (893). */
  async obtenerComision({ user }) {
    return this.fondosRepository.obtenerComision(
      contextoDeRol(user, 'ADMIN', 'solo el administrador del tenant consulta la comisión', 'MANI-FON-403')
    );
  }
}

module.exports = FundsUseCase;
