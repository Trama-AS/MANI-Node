const { ValidationError, NotFoundError, ForbiddenError } = require('../../../domain/errors/DomainError');

/**
 * Caso de Uso: Consultar Sitios de un Cliente Empresa (RF-08 / RF-09)
 * Retorna todos los sitios de servicio disponibles bajo la cuenta de una empresa.
 */
class GetCompanyClientSitesUseCase {
  /**
   * @param {import('./ICompanyClientRepository').ICompanyClientRepository} repository
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
   * @returns {Promise<{ client: import('../domain/CompanyClient').CompanyClient, sites: import('../domain/Site').Site[] }>}
   */
  async execute({ clienteId, tenantId, userId, userRole }) {
    if (!clienteId) throw new ValidationError('clienteId es requerido', 'VALIDATION_ERROR');
    if (!tenantId) throw new ValidationError('tenantId es requerido', 'VALIDATION_ERROR');

    const client = await this.repository.findById(clienteId, tenantId);
    if (!client) {
      throw new NotFoundError(`Cliente con ID "${clienteId}" no encontrado en tenant "${tenantId}".`, 'CLIENT_NOT_FOUND');
    }

    // Autorización y verificación de propiedad dentro del tenant (DoD §9.3)
    const normalizedRole = (userRole || '').toUpperCase();
    const isAdmin = ['ADMIN', 'ADMIN_TENANT'].includes(normalizedRole);
    if (!isAdmin && userId && client.usuarioId && client.usuarioId !== userId) {
      throw new ForbiddenError('No tiene permisos para consultar sedes de este cliente empresa', 'FORBIDDEN');
    }

    const sites = await this.repository.findSitesByClientId(clienteId, tenantId);
    return { client, sites };
  }
}

module.exports = { GetCompanyClientSitesUseCase };
