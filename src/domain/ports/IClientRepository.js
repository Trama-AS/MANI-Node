/**
 * Puerto de Dominio: Repositorio de Clientes (IClientRepository)
 */
class IClientRepository {
  /**
   * Obtiene el ID del usuario propietario de la empresa cliente
   * @param {string} tenantId
   * @param {string} clientId
   * @returns {Promise<string|null>}
   */
  async findUsuarioIdByClientId(_tenantId, _clientId) {
    throw new Error('IClientRepository#findUsuarioIdByClientId no implementado');
  }
}

module.exports = IClientRepository;
