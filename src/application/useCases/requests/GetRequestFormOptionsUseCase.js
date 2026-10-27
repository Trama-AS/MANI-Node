const { ForbiddenError, UnauthorizedError } = require('../../../domain/errors/DomainError');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * TEC-18 (SCRUM-1465): lo que el cliente necesita para crear una solicitud sin llamar a Supabase directo:
 * las categorías activas de su tenant y sus sitios con zona y zona padre. Mismos códigos MANI-SOL-* que la
 * creación (SCRUM-1072); tenant, usuario y rol salen del JWT (T4).
 */
class GetRequestFormOptionsUseCase {
  constructor({ requestFormRepository }) {
    if (!requestFormRepository) throw new Error('requestFormRepository es requerido');
    this.requestFormRepository = requestFormRepository;
  }

  contexto(user) {
    if (!user || !user.tenantId || !user.userId || !UUID_RE.test(String(user.userId))) {
      throw new UnauthorizedError('MANI-SOL-401: sesión requerida', 'MANI-SOL-401');
    }
    if (user.role !== 'CLIENT') {
      throw new ForbiddenError('MANI-SOL-403C: solo un cliente activo puede publicar solicitudes', 'MANI-SOL-403C');
    }
    return { tenantId: user.tenantId, userId: user.userId, role: user.role };
  }

  async categorias({ user }) {
    return this.requestFormRepository.listarCategorias(this.contexto(user));
  }

  async sitios({ user }) {
    return this.requestFormRepository.listarSitios(this.contexto(user));
  }
}

module.exports = GetRequestFormOptionsUseCase;
