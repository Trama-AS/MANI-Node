const IProfileRepository = require('../../domain/ports/IProfileRepository');
const Profile = require('../../domain/entities/Profile');

class InMemoryProfileRepository extends IProfileRepository {
  constructor() {
    super();
    this.profiles = [
      new Profile({
        id: 'demo-user-1',
        userId: 'demo-user-1',
        role: 'CLIENT',
        fullName: 'Usuario Demo MANI',
        status: 'VERIFIED',
        tenantId: 'trama-demo',
      }),
    ];
  }

  /**
   * Coincidencia exacta por userId Y tenantId (si se pasa tenantId). Sin
   * fallback a un perfil demo: un userId que no corresponde a ningún perfil
   * de ESE tenant debe dar 404, no filtrar datos de otro usuario/tenant (B4).
   */
  async findByUserId(userId, tenantId = null) {
    const profile = this.profiles.find(
      (p) => (p.userId === userId || p.id === userId) && (!tenantId || p.tenantId === tenantId)
    );
    return profile || null;
  }
}

module.exports = InMemoryProfileRepository;
