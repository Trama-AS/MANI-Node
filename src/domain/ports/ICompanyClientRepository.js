/**
 * Puerto (Interface): Repositorio de Cliente Empresa y Sitios
 * Define el contrato que la capa de infraestructura DEBE implementar.
 * La capa de aplicación depende exclusivamente de este contrato (Dependency Inversion Principle).
 */
class ICompanyClientRepository {
  /**
   * Guarda un nuevo cliente empresa junto con sus sitios asociados de forma transaccional.
   * @param {import('../entities/CompanyClient')} _companyClient
   * @param {import('../entities/Site')[]} _sites
   * @param {object} [_options]
   * @returns {Promise<{ client: import('../entities/CompanyClient'), sites: import('../entities/Site')[] }>}
   */
  async save(_companyClient, _sites, _options = {}) {
    throw new Error('Método save() no implementado.');
  }

  /**
   * Busca un cliente empresa por su ID y tenant.
   * @param {string} _id
   * @param {string} _tenantId
   * @returns {Promise<import('../entities/CompanyClient')|null>}
   */
  async findById(_id, _tenantId) {
    throw new Error('Método findById() no implementado.');
  }

  /**
   * Busca un cliente empresa por NIT y tenant.
   * @param {string} _nit
   * @param {string} _tenantId
   * @returns {Promise<import('../entities/CompanyClient')|null>}
   */
  async findByNitAndTenant(_nit, _tenantId) {
    throw new Error('Método findByNitAndTenant() no implementado.');
  }

  /**
   * Busca un cliente empresa por Email y tenant.
   * @param {string} _email
   * @param {string} _tenantId
   * @returns {Promise<import('../entities/CompanyClient')|null>}
   */
  async findByEmailAndTenant(_email, _tenantId) {
    throw new Error('Método findByEmailAndTenant() no implementado.');
  }

  /**
   * Registra un nuevo sitio asociado a una empresa existente.
   * @param {string} _clienteId
   * @param {string} _tenantId
   * @param {import('../entities/Site')} _site
   * @returns {Promise<import('../entities/Site')>}
   */
  async addSite(_clienteId, _tenantId, _site) {
    throw new Error('Método addSite() no implementado.');
  }

  /**
   * Lista todos los sitios registrados para una empresa.
   * @param {string} _clienteId
   * @param {string} _tenantId
   * @returns {Promise<import('../entities/Site')[]>}
   */
  async findSitesByClientId(_clienteId, _tenantId) {
    throw new Error('Método findSitesByClientId() no implementado.');
  }

  /**
   * Busca una sede de un cliente dentro del tenant. Devuelve null si no existe o es de otro cliente o tenant.
   * @param {string} _clienteId
   * @param {string} _siteId
   * @param {string} _tenantId
   * @returns {Promise<import('../entities/Site')|null>}
   */
  async findSiteById(_clienteId, _siteId, _tenantId) {
    throw new Error('Método findSiteById() no implementado.');
  }

  /**
   * Guarda los datos editables de una sede (nombre, dirección, zona y contacto). No toca las reglas.
   * @param {string} _clienteId
   * @param {string} _tenantId
   * @param {import('../entities/Site')} _site
   * @returns {Promise<import('../entities/Site')|null>} null si la sede ya no existe en ese cliente y tenant.
   */
  async updateSite(_clienteId, _tenantId, _site) {
    throw new Error('Método updateSite() no implementado.');
  }
}

ICompanyClientRepository.ICompanyClientRepository = ICompanyClientRepository;
module.exports = ICompanyClientRepository;
