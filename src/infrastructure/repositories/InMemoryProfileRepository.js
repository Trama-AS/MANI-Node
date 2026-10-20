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
      new Profile({
        id: 'demo-ally-1',
        userId: 'demo-ally-1',
        role: 'ALLY',
        fullName: 'Aliado Demo MANI',
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

  async updateOwnProfile(userId, tenantId, changes = {}) {
    const idx = this.profiles.findIndex(
      (p) => (p.userId === userId || p.id === userId) && (!tenantId || p.tenantId === tenantId)
    );
    if (idx === -1) return null;

    const current = this.profiles[idx];
    const updated = new Profile({
      id: current.id,
      userId: current.userId,
      role: current.role,
      fullName: changes.fullName !== undefined ? changes.fullName : current.fullName,
      status: current.status,
      tenantId: current.tenantId,
      phone: changes.phone !== undefined ? changes.phone : current.phone,
      address: changes.address !== undefined ? changes.address : current.address,
      photoUrl: changes.photoUrl !== undefined ? changes.photoUrl : current.photoUrl,
    });

    this.profiles[idx] = updated;
    return updated;
  }
}

module.exports = InMemoryProfileRepository;

