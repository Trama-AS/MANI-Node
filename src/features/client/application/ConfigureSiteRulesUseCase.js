const { SiteRules } = require('../domain/SiteRules');

/**
 * Caso de Uso: Configurar Reglas Contextuales del Sitio (SCRUM-853 / US-02.2.3 / RF-09)
 * Permite al cliente corporativo definir horarios de acceso, permisos exigidos (ARL, alturas),
 * elementos de protección personal (EPP) y requisitos de portería para su sede.
 */
class ConfigureSiteRulesUseCase {
  /**
   * @param {import('./ICompanyClientRepository').ICompanyClientRepository} repository
   */
  constructor(repository) {
    if (!repository) throw new Error('repository es requerido en ConfigureSiteRulesUseCase');
    this.repository = repository;
  }

  /**
   * @param {object} input
   * @param {string} input.siteId
   * @param {string} input.tenantId
   * @param {object} input.reglas - { horario, permisosRequeridos, elementosProteccion, instruccionesIngreso, requiereAprobacionPrevia, contactoAcceso }
   * @param {string} [input.correlationId]
   * @returns {Promise<{ site: import('../domain/Site').Site, reglas: SiteRules }>}
   */
  async execute({ siteId, tenantId, reglas, correlationId = 'none' }) {
    if (!siteId) throw new Error('siteId es requerido');
    if (!tenantId) throw new Error('tenantId es requerido');
    if (!reglas || typeof reglas !== 'object') {
      throw new Error('reglas es requerido y debe ser un objeto con la configuración');
    }

    // 1. Verificar existencia del sitio
    const existingSite = await this.repository.findSiteById(siteId, tenantId);
    if (!existingSite) {
      throw new Error(`Sitio con ID "${siteId}" no encontrado en tenant "${tenantId}".`);
    }

    // 2. Construir y validar las reglas en el dominio
    const siteRules = new SiteRules(reglas);
    siteRules.validate();

    // 3. Persistir en la infraestructura
    const updatedSite = await this.repository.updateSiteRules(siteId, tenantId, siteRules);

    console.log(
      `[ConfigureSiteRulesUseCase] Reglas contextuales actualizadas para sitio "${siteId}". Corr: ${correlationId}`
    );

    return {
      site: updatedSite,
      reglas: siteRules,
    };
  }
}

module.exports = { ConfigureSiteRulesUseCase };
