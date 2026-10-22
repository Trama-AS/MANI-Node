/**
 * Puerto (Interface): Repositorio de Sitios y Reglas Contextuales (RF-09 / SCRUM-853)
 */
class ISiteRepository {
  /**
   * Busca un sitio por su ID dentro del tenant dado.
   * @param {string} _id
   * @param {string} _tenantId
   * @returns {Promise<import('../entities/Site')|null>}
   */
  async findById(_id, _tenantId) {
    throw new Error('Método findById() no implementado.');
  }

  /**
   * Actualiza las reglas contextuales del sitio.
   * @param {string} _id
   * @param {string} _tenantId
   * @param {import('../entities/SiteRules')|object} _rules
   * @returns {Promise<import('../entities/Site')>}
   */
  async updateRules(_id, _tenantId, _rules) {
    throw new Error('Método updateRules() no implementado.');
  }

  /**
   * Registra un nuevo sitio (para seeding o creación directa).
   * @param {import('../entities/Site')} _site
   * @returns {Promise<import('../entities/Site')>}
   */
  async create(_site) {
    throw new Error('Método create() no implementado.');
  }

  /**
   * Indica si alguna de las solicitudes dadas es de este sitio en el tenant (SCRUM-853). Core es dueño de la
   * solicitud y de su sitio; la asignación la entrega Dispatch.
   * @param {string} _siteId
   * @param {string} _tenantId
   * @param {string[]} _requestIds
   * @returns {Promise<boolean>}
   */
  async hasRequestInSite(_siteId, _tenantId, _requestIds) {
    throw new Error('Método hasRequestInSite() no implementado.');
  }
}

module.exports = ISiteRepository;
