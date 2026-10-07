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
   * @returns {Promise<{ client: import('../domain/CompanyClient').CompanyClient, sites: import('../domain/Site').Site[] }>}
   */
  async execute({ clienteId, tenantId }) {
    if (!clienteId) throw new Error('clienteId es requerido');
    if (!tenantId) throw new Error('tenantId es requerido');

    const client = await this.repository.findById(clienteId, tenantId);
    if (!client) {
      throw new Error(`Cliente con ID "${clienteId}" no encontrado en tenant "${tenantId}".`);
    }

    const sites = await this.repository.findSitesByClientId(clienteId, tenantId);
    return { client, sites };
  }
}

module.exports = { GetCompanyClientSitesUseCase };
