const { DomainError } = require('../../../domain/errors/DomainError');

/** Zonas de cobertura del aliado de la sesión. Tenant, usuario y rol salen del JWT (ADR-0018/0032). */
class GetAllyCoverageUseCase {
  constructor({ coberturaRepository }) {
    if (!coberturaRepository) throw new Error('coberturaRepository es requerido para GetAllyCoverageUseCase');
    this.coberturaRepository = coberturaRepository;
  }

  async execute({ user } = {}) {
    if (!user?.userId || !user?.tenantId) throw new DomainError('MANI-COB-401: sesión requerida', 'MANI-COB-401', 401);
    if (user.role !== 'ALLY') {
      throw new DomainError('MANI-COB-403: solo un aliado activo puede declarar cobertura', 'MANI-COB-403', 403);
    }
    const zones = await this.coberturaRepository.obtener({ tenantId: user.tenantId, userId: user.userId, role: user.role });
    return { zones, zoneIds: zones.map((z) => z.id) };
  }
}

module.exports = GetAllyCoverageUseCase;
