const { NotFoundError, ValidationError } = require('../../../domain/errors/DomainError');
const { conFotoFirmada } = require('./fotoPerfilFirmada');

class GetOwnProfileUseCase {
  constructor({ profileRepository, tenantRepository = null, fileStorageService = null }) {
    if (!profileRepository) {
      throw new Error('profileRepository es requerido para GetOwnProfileUseCase');
    }
    this.profileRepository = profileRepository;
    this.tenantRepository = tenantRepository;
    this.fileStorageService = fileStorageService;
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
    // La base guarda la ruta en Storage; el cliente recibe una URL firmada que pueda abrir (SCRUM-1634).
    return conFotoFirmada(json, this.fileStorageService);
  }
}

module.exports = GetOwnProfileUseCase;

