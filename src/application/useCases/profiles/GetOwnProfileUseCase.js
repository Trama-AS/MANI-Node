const { NotFoundError, ValidationError } = require('../../../domain/errors/DomainError');

class GetOwnProfileUseCase {
  constructor({ profileRepository }) {
    if (!profileRepository) {
      throw new Error('profileRepository es requerido para GetOwnProfileUseCase');
    }
    this.profileRepository = profileRepository;
  }

  async execute({ userId, tenantId = null } = {}) {
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      throw new ValidationError('El identificador de usuario (userId) es requerido');
    }

    const profile = await this.profileRepository.findByUserId(userId, tenantId);
    if (!profile) {
      throw new NotFoundError(`No se encontró un perfil para el usuario ${userId}`);
    }

    return typeof profile.toJSON === 'function' ? profile.toJSON() : profile;
  }
}

module.exports = GetOwnProfileUseCase;

