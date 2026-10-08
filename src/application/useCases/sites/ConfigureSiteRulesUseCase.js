const SiteRules = require('../../../domain/entities/SiteRules');
const { ValidationError, NotFoundError } = require('../../../domain/errors/DomainError');

/**
 * Caso de Uso: Configurar Reglas Contextuales del Sitio (SCRUM-853 / US-02.2.3 / RF-09)
 * Permite definir horarios de acceso, permisos exigidos (ARL, alturas),
 * elementos de protección personal (EPP) y requisitos de ingreso para la sede.
 */
class ConfigureSiteRulesUseCase {
  /**
   * @param {object} dependencies
   * @param {import('../../../domain/ports/ISiteRepository')} dependencies.siteRepository
   */
  constructor({ siteRepository } = {}) {
    if (!siteRepository) {
      throw new Error('siteRepository es requerido en ConfigureSiteRulesUseCase');
    }
    this.siteRepository = siteRepository;
  }

  /**
   * @param {object} input
   * @param {string} input.siteId
   * @param {string} input.tenantId
   * @param {object} input.reglas
   * @returns {Promise<{ site: import('../../../domain/entities/Site'), reglas: SiteRules }>}
   */
  async execute({ siteId, tenantId, reglas }) {
    if (!siteId) throw new ValidationError('siteId es requerido', 'VALIDATION_ERROR');
    if (!tenantId) throw new ValidationError('tenantId es requerido', 'VALIDATION_ERROR');
    if (!reglas || typeof reglas !== 'object') {
      throw new ValidationError('reglas es requerido y debe ser un objeto', 'VALIDATION_ERROR');
    }

    // 1. Verificar existencia del sitio bajo el tenant
    const existingSite = await this.siteRepository.findById(siteId, tenantId);
    if (!existingSite) {
      throw new NotFoundError(`Sitio con ID "${siteId}" no encontrado en tenant "${tenantId}".`, 'SITE_NOT_FOUND');
    }

    // 2. Construir y validar las reglas en el dominio
    const siteRules = new SiteRules(reglas);
    siteRules.validate();

    // 3. Persistir en la infraestructura
    const updatedSite = await this.siteRepository.updateRules(siteId, tenantId, siteRules);

    return {
      site: updatedSite,
      reglas: siteRules,
    };
  }
}

module.exports = ConfigureSiteRulesUseCase;
