const { NotFoundError, ValidationError } = require('../../../domain/errors/DomainError');

class GetOwnProfileUseCase {
  constructor({ profileRepository, tenantRepository = null }) {
    if (!profileRepository) {
      throw new Error('profileRepository es requerido para GetOwnProfileUseCase');
    }
    this.profileRepository = profileRepository;
    this.tenantRepository = tenantRepository;
  }

  async execute({ userId, tenantId = null } = {}) {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new ValidationError('El identificador de usuario (userId) es requerido');
    }

    const profile = await this.profileRepository.findByUserId(userId, tenantId);
    if (!profile) {
      throw new NotFoundError(`No se encontró un perfil para el usuario ${userId}`);
    }

    const json = typeof profile.toJSON === 'function' ? profile.toJSON() : { ...profile };

    // SCRUM-1364 (C1): el nombre es el del tenant de la sesión, nunca el de otro. Así el front no necesita
    // consultar el listado global de tenants para mostrar la empresa en la cabecera.
    const ownTenantId = json.tenantId || tenantId;
    if (this.tenantRepository && ownTenantId) {
      const tenant = await this.tenantRepository.findById(ownTenantId);
      if (tenant?.name) json.tenantName = tenant.name;
    }
    return json;
  }
}

module.exports = GetOwnProfileUseCase;

