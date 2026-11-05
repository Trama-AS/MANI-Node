const { ValidationError } = require('../../../domain/errors/DomainError');
const { assertClientOwnerOrAdmin, cargarCliente } = require('./clientAccess');

/**
 * Caso de Uso: Consultar Sitios de un Cliente Empresa (RF-08 / RF-09)
 * Retorna todos los sitios de servicio disponibles bajo la cuenta de una empresa.
 */
class GetCompanyClientSitesUseCase {
  /**
   * @param {import('../../../domain/ports/ICompanyClientRepository')} repository
   */
  constructor(repository) {
    if (!repository) throw new Error('repository es requerido en GetCompanyClientSitesUseCase');
    this.repository = repository;
  }

  /**
   * @param {object} input
   * @param {string} input.clienteId - Id del cliente o `me` para el cliente de la sesión
   * @param {string} input.tenantId
   * @param {string} [input.userId]
   * @param {string} [input.userRole]
   * @returns {Promise<{ client: import('../../../domain/entities/CompanyClient'), sites: import('../../../domain/entities/Site')[] }>}
   */
  async execute({ clienteId, tenantId, userId, userRole }) {
    if (!clienteId) throw new ValidationError('clienteId es requerido', 'VALIDATION_ERROR');
    if (!tenantId) throw new ValidationError('tenantId es requerido', 'VALIDATION_ERROR');

    const client = await cargarCliente(this.repository, { clienteId, tenantId, userId });

    // Autorización y verificación de propiedad dentro del tenant (DoD §9.3), con falla cerrada (T9)
    assertClientOwnerOrAdmin({
      client,
      userId,
      userRole,
      mensaje: 'No tiene permisos para consultar sedes de este cliente empresa',
    });

    const sites = await this.repository.findSitesByClientId(client.id, tenantId);
    return { client, sites };
  }
}

GetCompanyClientSitesUseCase.GetCompanyClientSitesUseCase = GetCompanyClientSitesUseCase;
module.exports = GetCompanyClientSitesUseCase;
