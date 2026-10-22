/**
 * Interfaz / Puerto de Dominio para persistencia de Perfiles.
 */
class IProfileRepository {
  async findByUserId(_userId, _tenantId = null) {
    throw new Error('Método findByUserId() no implementado en IProfileRepository');
  }

  async updateOwnProfile(_userId, _tenantId, _changes) {
    throw new Error('Método updateOwnProfile() no implementado en IProfileRepository');
  }
}

module.exports = IProfileRepository;


