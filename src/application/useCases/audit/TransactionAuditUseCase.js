const { ForbiddenError, UnauthorizedError, ValidationError } = require('../../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITE_POR_OMISION = 50;
const LIMITE_MAXIMO = 100;

function invalido(mensaje) {
  return new ValidationError(`MANI-AUD-400: ${mensaje}`, 'MANI-AUD-400');
}

function uuid(valor, campo) {
  if (!UUID_RE.test(String(valor || ''))) throw invalido(`${campo} no es un UUID válido`);
  return String(valor);
}

function contexto(user, rolesPermitidos) {
  if (!user || !user.tenantId || !user.userId || !UUID_RE.test(String(user.userId))) {
    throw new UnauthorizedError('MANI-AUD-401: sesión requerida', 'MANI-AUD-401');
  }
  // El claim del administrador llega como ADMIN; ADMIN_TENANT se acepta por compatibilidad con el middleware.
  const role = user.role === 'ADMIN_TENANT' ? 'ADMIN' : user.role;
  if (!rolesPermitidos.includes(role)) {
    throw new ForbiddenError(
      'MANI-AUD-403: tu rol no puede consultar el registro de transacciones de este recurso',
      'MANI-AUD-403'
    );
  }
  return { tenantId: user.tenantId, userId: user.userId, role };
}

/**
 * Consulta del registro inmutable de transacciones (SCRUM-889, HU-M11-03, C3). El cliente ve los eventos de sus
 * propios pagos; el administrador del tenant ve los de su tenant; nadie más. Nadie lo modifica por esta vía.
 */
class TransactionAuditUseCase {
  constructor({ auditRepository }) {
    if (!auditRepository) throw new Error('auditRepository es requerido para TransactionAuditUseCase');
    this.auditRepository = auditRepository;
  }

  async porPago({ user, pagoId }) {
    const ctx = contexto(user, ['CLIENT', 'ADMIN']);
    return this.auditRepository.listarPorPago(ctx, { pagoId: uuid(pagoId, 'el id del pago') });
  }

  async listar({ user, query = {} }) {
    const ctx = contexto(user, ['ADMIN']);
    let limite = LIMITE_POR_OMISION;
    if (query.limite !== undefined) {
      limite = Number(query.limite);
      if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_MAXIMO) {
        throw invalido(`limite debe ser un entero entre 1 y ${LIMITE_MAXIMO}`);
      }
    }
    return this.auditRepository.listar(ctx, {
      limite,
      despuesDe: query.despuesDe ? uuid(query.despuesDe, 'despuesDe') : null,
      pagoId: query.pagoId ? uuid(query.pagoId, 'pagoId') : null,
    });
  }
}

module.exports = TransactionAuditUseCase;
