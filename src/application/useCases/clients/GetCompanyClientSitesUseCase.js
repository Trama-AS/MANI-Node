const { ValidationError, NotFoundError } = require('../../../domain/errors/DomainError');
const { assertClientOwnerOrAdmin } = require('./clientAccess');

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
   * @param {string} input.clienteId
   * @param {string} input.tenantId
   * @param {string} [input.userId]
   * @param {string} [input.userRole]
   * @returns {Promise<{ client: import('../../../domain/entities/CompanyClient'), sites: import('../../../domain/entities/Site')[] }>}
   */
  async execute({ clienteId, tenantId, userId, userRole }) {
    if (!clienteId) throw new ValidationError('clienteId es requerido', 'VALIDATION_ERROR');
    if (!tenantId) throw new ValidationError('tenantId es requerido', 'VALIDATION_ERROR');

    const client = await this.repository.findById(clienteId, tenantId);
    if (!client) {
      throw new NotFoundError(`Cliente con ID "${clienteId}" no encontrado en tenant "${tenantId}".`, 'CLIENT_NOT_FOUND');
    }

    // Autorización y verificación de propiedad dentro del tenant (DoD §9.3), con falla cerrada (T9)
    assertClientOwnerOrAdmin({
      client,
      userId,
      userRole,
      mensaje: 'No tiene permisos para consultar sedes de este cliente empresa',
    });

    const sites = await this.repository.findSitesByClientId(clienteId, tenantId);
    return { client, sites };
  }
}

GetCompanyClientSitesUseCase.GetCompanyClientSitesUseCase = GetCompanyClientSitesUseCase;
module.exports = GetCompanyClientSitesUseCase;
