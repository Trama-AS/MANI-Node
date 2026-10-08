const SiteRules = require('../../../domain/entities/SiteRules');
const { ValidationError, NotFoundError } = require('../../../domain/errors/DomainError');

/**
 * Caso de Uso: Consultar Reglas del Sitio Visibles al Aliado (SCRUM-853 / US-02.2.3 / RF-09 / QS-06)
 * Permite a los aliados autenticados en el tenant conocer las restricciones y condiciones de acceso
 * antes de agendar o aceptar un servicio.
 */
class GetSiteRulesForAllyUseCase {
  /**
   * @param {object} dependencies
   * @param {import('../../../domain/ports/ISiteRepository')} dependencies.siteRepository
   */
  constructor({ siteRepository } = {}) {
    if (!siteRepository) {
      throw new Error('siteRepository es requerido en GetSiteRulesForAllyUseCase');
    }
    this.siteRepository = siteRepository;
  }

  /**
   * @param {object} input
   * @param {string} input.siteId
   * @param {string} input.tenantId
   * @returns {Promise<object>}
   */
  async execute({ siteId, tenantId }) {
    if (!siteId) throw new ValidationError('siteId es requerido', 'VALIDATION_ERROR');
    if (!tenantId) throw new ValidationError('tenantId es requerido', 'VALIDATION_ERROR');

    const site = await this.siteRepository.findById(siteId, tenantId);
    if (!site) {
      throw new NotFoundError(`Sitio con ID "${siteId}" no encontrado en tenant "${tenantId}".`, 'SITE_NOT_FOUND');
    }

    const rulesInstance =
      site.reglas instanceof SiteRules
        ? site.reglas
        : site.reglas
        ? new SiteRules(site.reglas)
        : new SiteRules();

    const highlightedView = rulesInstance.toAllyHighlightedView();

    return {
      siteId: site.id,
      nombreSitio: site.nombre,
      direccion: site.direccion,
      zonaId: site.zonaId,
      tieneRestricciones: highlightedView.totalRequisitos > 0 || Boolean(rulesInstance.horario),
      reglasDestacadas: highlightedView,
      reglasRaw: rulesInstance.toJSON(),
    };
  }
}

module.exports = GetSiteRulesForAllyUseCase;
