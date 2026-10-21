const SiteRules = require('../../../domain/entities/SiteRules');
const { ValidationError, NotFoundError, ForbiddenError } = require('../../../domain/errors/DomainError');
const { assertSiteOwnerOrAdmin } = require('./siteAccess');

/**
 * Caso de Uso: Consultar Reglas del Sitio Visibles al Aliado (SCRUM-853 / US-02.2.3 / RF-09 / QS-06)
 * Devuelve las restricciones y condiciones de acceso de la sede. Las leen el cliente dueño, el admin del
 * tenant y el aliado asignado a una solicitud de ese sitio (criterio C1). Cualquier otro usuario del tenant
 * recibe 403 sin datos: las reglas incluyen instrucciones y contacto de ingreso (criterio C2).
 *
 * Para el aliado, la asignación se pregunta a Dispatch por HTTP (criterio T1: es su dominio) y Core cruza esas
 * solicitudes con su sitio, que es dato de Core. Si Dispatch no responde, 503 (criterio T2). Como se usa el sitio
 * actual de la solicitud, si la solicitud cambia de sitio el aliado ve las reglas del nuevo (criterio C5).
 */
class GetSiteRulesForAllyUseCase {
  /**
   * @param {object} dependencies
   * @param {import('../../../domain/ports/ISiteRepository')} dependencies.siteRepository
   * @param {import('../../../domain/ports/IClientRepository')} dependencies.clientRepository
   * @param {import('../../../domain/ports/IDispatchAssignmentService')} dependencies.dispatchAssignmentService
   */
  constructor({ siteRepository, clientRepository, dispatchAssignmentService } = {}) {
    if (!siteRepository) {
      throw new Error('siteRepository es requerido en GetSiteRulesForAllyUseCase');
    }
    if (!clientRepository) {
      throw new Error('clientRepository es requerido en GetSiteRulesForAllyUseCase');
    }
    if (!dispatchAssignmentService) {
      throw new Error('dispatchAssignmentService es requerido en GetSiteRulesForAllyUseCase');
    }
    this.siteRepository = siteRepository;
    this.clientRepository = clientRepository;
    this.dispatchAssignmentService = dispatchAssignmentService;
  }

  /**
   * @param {object} input
   * @param {string} input.siteId
   * @param {string} input.tenantId
   * @param {string} [input.userId]
   * @param {string} [input.role]
   * @param {string} [input.authorization] - JWT del aliado, para reenviarlo a Dispatch
   * @param {string} [input.correlationId]
   * @returns {Promise<object>}
   */
  async execute({ siteId, tenantId, userId, role, authorization, correlationId }) {
    if (!siteId) throw new ValidationError('siteId es requerido', 'VALIDATION_ERROR');
    if (!tenantId) throw new ValidationError('tenantId es requerido', 'VALIDATION_ERROR');

    const site = await this.siteRepository.findById(siteId, tenantId);
    if (!site) {
      throw new NotFoundError(`Sitio con ID "${siteId}" no encontrado en tenant "${tenantId}".`, 'SITE_NOT_FOUND');
    }

    if (role === 'ALLY') {
      await this.assertAllyAssignedToSite({ siteId, tenantId, authorization, correlationId });
    } else {
      await assertSiteOwnerOrAdmin({
        site,
        tenantId,
        userId,
        role,
        clientRepository: this.clientRepository,
        mensaje: 'Solo el cliente dueño de la sede, el admin del tenant o el aliado asignado consultan sus reglas',
      });
    }

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

  async assertAllyAssignedToSite({ siteId, tenantId, authorization, correlationId }) {
    const requestIds = await this.dispatchAssignmentService.listMyAssignedRequestIds({ authorization, correlationId });
    const asignado = requestIds.length > 0 && (await this.siteRepository.hasRequestInSite(siteId, tenantId, requestIds));
    if (!asignado) {
      throw new ForbiddenError('El aliado solo consulta las reglas de un sitio donde tiene un servicio asignado', 'FORBIDDEN');
    }
  }
}

module.exports = GetSiteRulesForAllyUseCase;
