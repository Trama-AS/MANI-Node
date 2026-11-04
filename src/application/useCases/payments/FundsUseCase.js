const { DomainError, ForbiddenError, UnauthorizedError } = require('../../../domain/errors/DomainError');
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

  /** Fija la comisión del tenant. Un valor fuera de 0 a 100 se rechaza y no cambia nada (C2 de 893). */
  async fijarComision({ user, body = {} }) {
    const ctx = contextoDeRol(user, 'ADMIN', 'solo el administrador del tenant configura la comisión', 'MANI-FON-403');
    const crudo = body.porcentaje;
    const porcentaje = typeof crudo === 'string' && crudo.trim() !== '' ? Number(crudo) : crudo;
    if (typeof porcentaje !== 'number' || !Number.isFinite(porcentaje) || porcentaje < 0 || porcentaje > 100) {
      throw new DomainError('MANI-FON-422: el porcentaje de comisión debe ser un número entre 0 y 100', 'MANI-FON-422', 422);
    }
    // Hasta dos decimales, como la columna: no se redondea en silencio un valor que el usuario escribió.
    if (Math.round(porcentaje * 100) / 100 !== porcentaje) {
      throw new DomainError('MANI-FON-422: el porcentaje admite hasta dos decimales', 'MANI-FON-422', 422);
    }
    return this.fondosRepository.fijarComision(ctx, porcentaje);
  }
}

module.exports = FundsUseCase;
