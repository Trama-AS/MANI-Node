const { UnauthorizedError, ForbiddenError, ValidationError, NotFoundError } = require('../../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * HU-M07-04 (SCRUM-871, opción B del 26-oct): el cliente consulta el estado de sus solicitudes y la zona que se
 * declaró al publicarlas. No es ubicación del aliado ni rastreo en vivo (SRS §1.2): la zona es la de la solicitud
 * y `actualizadaEn` dice de cuándo es el estado. Tenant, usuario y rol salen del JWT verificado (T4); solo se ven
 * las solicitudes del cliente de la sesión, y una ajena responde igual que una inexistente (404, sin filtrar su
 * existencia).
 */
class ConsultOwnServiceRequestsUseCase {
  constructor({ serviceRequestRepository }) {
    if (!serviceRequestRepository) throw new Error('serviceRequestRepository es requerido');
    this.serviceRequestRepository = serviceRequestRepository;
  }

  async listar({ user }) {
    const ctx = this._sesion(user);
    return this.serviceRequestRepository.listarDelCliente(ctx);
  }

  async obtener({ user, solicitudId }) {
    const ctx = this._sesion(user);
    if (typeof solicitudId !== 'string' || !UUID_RE.test(solicitudId)) {
      throw new ValidationError('MANI-SOL-400: el id de la solicitud debe ser un UUID válido', 'MANI-SOL-400');
    }
    const solicitud = await this.serviceRequestRepository.obtenerDelCliente(ctx, solicitudId);
    if (!solicitud) {
      throw new NotFoundError('MANI-SOL-404: solicitud no encontrada', 'MANI-SOL-404');
    }
    return solicitud;
  }

  _sesion(user) {
    if (!user || !user.tenantId || !user.userId) {
      throw new UnauthorizedError('MANI-SOL-401: sesión requerida', 'MANI-SOL-401');
    }
    if (user.role !== 'CLIENT') {
      throw new ForbiddenError('MANI-SOL-403C: solo el cliente consulta sus solicitudes', 'MANI-SOL-403C');
    }
    if (!UUID_RE.test(String(user.userId))) {
      throw new UnauthorizedError('MANI-SOL-401: sesión sin identificador de usuario válido', 'MANI-SOL-401');
    }
    return { tenantId: user.tenantId, userId: user.userId, role: user.role };
  }
}

module.exports = ConsultOwnServiceRequestsUseCase;
