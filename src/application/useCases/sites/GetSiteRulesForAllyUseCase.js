const SiteRules = require('../../../domain/entities/SiteRules');
const { ValidationError, NotFoundError } = require('../../../domain/errors/DomainError');
const { assertSiteOwnerOrAdmin } = require('./siteAccess');

/**
 * Caso de Uso: Consultar Reglas del Sitio Visibles al Aliado (SCRUM-853 / US-02.2.3 / RF-09 / QS-06)
 * Devuelve las restricciones y condiciones de acceso de la sede. Las leen el cliente dueño y el admin del
 * tenant; el aliado asignado se habilita cuando la asignación esté en Core (ver `siteAccess.js`). Cualquier
 * otro usuario del tenant recibe 403 sin datos: las reglas incluyen instrucciones y contacto de ingreso.
 */
class GetSiteRulesForAllyUseCase {
  /**
   * @param {object} dependencies
   * @param {import('../../../domain/ports/ISiteRepository')} dependencies.siteRepository
   * @param {import('../../../domain/ports/IClientRepository')} dependencies.clientRepository
   */
  constructor({ siteRepository, clientRepository } = {}) {
    if (!siteRepository) {
      throw new Error('siteRepository es requerido en GetSiteRulesForAllyUseCase');
    }
    if (!clientRepository) {
      throw new Error('clientRepository es requerido en GetSiteRulesForAllyUseCase');
    }
    this.siteRepository = siteRepository;
    this.clientRepository = clientRepository;
  }

  /**
   * @param {object} input
   * @param {string} input.siteId
   * @param {string} input.tenantId
   * @param {string} [input.userId]
   * @param {string} [input.role]
   * @returns {Promise<object>}
   */
  async execute({ siteId, tenantId, userId, role }) {
    if (!siteId) throw new ValidationError('siteId es requerido', 'VALIDATION_ERROR');
    if (!tenantId) throw new ValidationError('tenantId es requerido', 'VALIDATION_ERROR');

    const site = await this.siteRepository.findById(siteId, tenantId);
    if (!site) {
      throw new NotFoundError(`Sitio con ID "${siteId}" no encontrado en tenant "${tenantId}".`, 'SITE_NOT_FOUND');
    }

    await assertSiteOwnerOrAdmin({
      site,
      tenantId,
      userId,
      role,
      clientRepository: this.clientRepository,
      mensaje: 'Solo el cliente dueño de la sede o el admin del tenant consultan sus reglas',
    });

    const rulesInstance = SiteRules.from(site.reglas);

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
