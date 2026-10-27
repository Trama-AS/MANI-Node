const { ForbiddenError, UnauthorizedError, ValidationError } = require('../../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * HU-M05-07 (SCRUM-1403), decisión 6A: comando de asignación que Dispatch entrega a Core cuando un aliado acepta.
 * Core es el único que escribe el estado de la solicitud; Dispatch reenvía el JWT del aliado, así que el aliado,
 * el tenant y el rol salen de la sesión y el cuerpo va vacío. Es idempotente para el mismo aliado.
 * Cada intento queda en un log JSON con el correlationId y el resultado (QS-12).
 */
class AssignServiceRequestUseCase {
  constructor({ solicitudAsignacionRepository, auditLogger = (entry) => console.info(JSON.stringify(entry)) }) {
    if (!solicitudAsignacionRepository) throw new Error('solicitudAsignacionRepository es requerido');
    this.solicitudAsignacionRepository = solicitudAsignacionRepository;
    this.auditLogger = auditLogger;
  }

  async execute({ user, solicitudId, correlationId = null, idempotencyKey = null }) {
    if (!user || !user.tenantId || !UUID_RE.test(String(user.userId || ''))) {
      throw new UnauthorizedError('MANI-SOL-401: sesión requerida', 'MANI-SOL-401');
    }
    if (user.role !== 'ALLY') {
      throw new ForbiddenError('MANI-SOL-403: solo un aliado activo puede aceptar solicitudes', 'MANI-SOL-403');
    }
    if (!UUID_RE.test(String(solicitudId || ''))) {
      throw new ValidationError('MANI-SOL-400: el id de la solicitud no es válido', 'MANI-SOL-400');
    }

    const ctx = { tenantId: user.tenantId, userId: user.userId, role: user.role };
    const registro = { evento: 'SOLICITUD_ASIGNACION', correlationId, idempotencyKey, tenantId: ctx.tenantId, solicitudId, usuarioId: ctx.userId };
    try {
      const resultado = await this.solicitudAsignacionRepository.asignar(ctx, solicitudId);
      this.auditLogger({ ...registro, resultado: resultado.asignada ? 'ASIGNADA' : 'REINTENTO' });
      return resultado;
    } catch (err) {
      this.auditLogger({ ...registro, resultado: 'RECHAZADA', code: err.code || 'INTERNAL_ERROR' });
      throw err;
    }
  }
}

module.exports = AssignServiceRequestUseCase;
