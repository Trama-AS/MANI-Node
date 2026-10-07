/**
 * Puerto (Interface): Repositorio de Cliente Empresa y Sitios
 * Define el contrato que la capa de infraestructura DEBE implementar.
 * La capa de aplicación depende exclusivamente de este contrato (Dependency Inversion Principle).
 */
class ICompanyClientRepository {
  /**
   * Guarda un nuevo cliente empresa junto con sus sitios asociados de forma transaccional.
   * @param {import('../domain/CompanyClient').CompanyClient} companyClient
   * @param {import('../domain/Site').Site[]} sites
   * @returns {Promise<{ client: import('../domain/CompanyClient').CompanyClient, sites: import('../domain/Site').Site[] }>}
   */
  async save(companyClient, sites) {
    throw new Error('Método save() no implementado.');
  }

  /**
   * Busca un cliente empresa por su ID y tenant.
   * @param {string} id
   * @param {string} tenantId
   * @returns {Promise<import('../domain/CompanyClient').CompanyClient|null>}
   */
  async findById(id, tenantId) {
    throw new Error('Método findById() no implementado.');
  }

  /**
   * Busca un cliente empresa por NIT y tenant.
   * @param {string} nit
   * @param {string} tenantId
   * @returns {Promise<import('../domain/CompanyClient').CompanyClient|null>}
   */
  async findByNitAndTenant(nit, tenantId) {
    throw new Error('Método findByNitAndTenant() no implementado.');
  }

  /**
   * Busca un cliente empresa por Email y tenant.
   * @param {string} email
   * @param {string} tenantId
   * @returns {Promise<import('../domain/CompanyClient').CompanyClient|null>}
   */
  async findByEmailAndTenant(email, tenantId) {
    throw new Error('Método findByEmailAndTenant() no implementado.');
  }

  /**
   * Registra un nuevo sitio asociado a una empresa existente.
   * @param {string} clienteId
   * @param {string} tenantId
   * @param {import('../domain/Site').Site} site
   * @returns {Promise<import('../domain/Site').Site>}
   */
  async addSite(clienteId, tenantId, site) {
    throw new Error('Método addSite() no implementado.');
  }

  /**
   * Lista todos los sitios registrados para una empresa.
   * @param {string} clienteId
   * @param {string} tenantId
   * @returns {Promise<import('../domain/Site').Site[]>}
   */
  async findSitesByClientId(clienteId, tenantId) {
    throw new Error('Método findSitesByClientId() no implementado.');
  }
}

module.exports = { ICompanyClientRepository };
