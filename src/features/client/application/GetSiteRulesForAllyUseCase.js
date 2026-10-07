const { SiteRules } = require('../domain/SiteRules');

/**
 * Caso de Uso: Consultar Reglas del Sitio Visibles al Aliado (SCRUM-853 / US-02.2.3 / RF-09 / QS-06)
 *
 * Criterio de Aceptación (BDD Scenario 1):
 * Given un sitio con reglas de horario y permisos,
 * When un aliado consulta la solicitud o sede asociada,
 * Then las reglas aparecen destacadas antes de aceptar o programar el servicio.
 *
 * Calidad Arquitectónica (QS-06):
 * 100% de las reglas del sitio visibles para el aliado antes de aceptar la solicitud.
 */
class GetSiteRulesForAllyUseCase {
  /**
   * @param {import('./ICompanyClientRepository').ICompanyClientRepository} repository
   */
  constructor(repository) {
    if (!repository) throw new Error('repository es requerido en GetSiteRulesForAllyUseCase');
    this.repository = repository;
  }

  /**
   * @param {object} input
   * @param {string} input.siteId
   * @param {string} input.tenantId
   * @param {string} [input.correlationId]
   * @returns {Promise<object>}
   */
  async execute({ siteId, tenantId, correlationId = 'none' }) {
    if (!siteId) throw new Error('siteId es requerido');
    if (!tenantId) throw new Error('tenantId es requerido');

    const site = await this.repository.findSiteById(siteId, tenantId);
    if (!site) {
      throw new Error(`Sitio con ID "${siteId}" no encontrado en tenant "${tenantId}".`);
    }

    const rulesInstance =
      site.reglas instanceof SiteRules
        ? site.reglas
        : site.reglas
        ? new SiteRules(site.reglas)
        : new SiteRules();

    const highlightedView = rulesInstance.toAllyHighlightedView();

    console.log(
      `[GetSiteRulesForAllyUseCase] Exponiendo ${highlightedView.totalRequisitos} requisitos del sitio "${siteId}" al aliado. Corr: ${correlationId}`
    );

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

module.exports = { GetSiteRulesForAllyUseCase };
