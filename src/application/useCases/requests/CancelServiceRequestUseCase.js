const { DomainError, UnauthorizedError, ForbiddenError, ValidationError } = require('../../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MOTIVO = 200;

/**
 * US-04.5.1 (SCRUM-877): el cliente cancela su solicitud antes de la ejecución. Qué estados se pueden cancelar
 * y la concurrencia con la aceptación viven en el repositorio, en una sola transacción. Tenant, usuario y rol
 * salen del JWT verificado (T4); el cuerpo solo aporta el motivo, que es opcional.
 */
class CancelServiceRequestUseCase {
  constructor({ serviceRequestRepository }) {
    if (!serviceRequestRepository) throw new Error('serviceRequestRepository es requerido');
    this.serviceRequestRepository = serviceRequestRepository;
  }

  async execute({ user, solicitudId, body = {} }) {
    if (!user || !user.tenantId || !user.userId) {
      throw new UnauthorizedError('MANI-SOL-401: sesión requerida', 'MANI-SOL-401');
    }
    if (user.role !== 'CLIENT') {
      throw new ForbiddenError('MANI-SOL-403C: solo el cliente cancela sus solicitudes', 'MANI-SOL-403C');
    }
    if (!UUID_RE.test(String(user.userId))) {
      throw new UnauthorizedError('MANI-SOL-401: sesión sin identificador de usuario válido', 'MANI-SOL-401');
    }
    if (typeof solicitudId !== 'string' || !UUID_RE.test(solicitudId)) {
      throw new ValidationError('MANI-SOL-400: el id de la solicitud debe ser un UUID válido', 'MANI-SOL-400');
    }

    const motivo = body.motivo === undefined || body.motivo === null ? '' : String(body.motivo).trim();
    if (motivo.length > MAX_MOTIVO) {
      throw new DomainError(`MANI-SOL-422M: el motivo no puede superar ${MAX_MOTIVO} caracteres`, 'MANI-SOL-422M', 422);
    }

    return this.serviceRequestRepository.cancelar(
      { tenantId: user.tenantId, userId: user.userId, role: user.role },
      { solicitudId, motivo: motivo || null }
    );
  }
}

module.exports = CancelServiceRequestUseCase;
