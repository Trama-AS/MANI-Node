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

  async findByUserId(userId, _tenantId = null) {
    // Busca por userId o id. Para compatibilidad con tokens demo, si no se encuentra exacto retorna el demo user por defecto
    const profile = this.profiles.find((p) => p.userId === userId || p.id === userId);
    return profile || this.profiles[0];
  }
}

module.exports = InMemoryProfileRepository;

