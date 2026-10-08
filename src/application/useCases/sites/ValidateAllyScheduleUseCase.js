const SiteRules = require('../../../domain/entities/SiteRules');
const { ValidationError, NotFoundError } = require('../../../domain/errors/DomainError');

/**
 * Caso de Uso: Validar Agenda Propuesta por el Aliado contra Reglas del Sitio
 * (SCRUM-853 / US-02.2.3 / RF-09)
 */
class ValidateAllyScheduleUseCase {
  /**
   * @param {object} dependencies
   * @param {import('../../../domain/ports/ISiteRepository')} dependencies.siteRepository
   */
  constructor({ siteRepository } = {}) {
    if (!siteRepository) {
      throw new Error('siteRepository es requerido en ValidateAllyScheduleUseCase');
    }
    this.siteRepository = siteRepository;
  }

  /**
   * @param {object} input
   * @param {string} input.siteId
   * @param {string} input.tenantId
   * @param {string|Date} input.fechaHoraPropuesta
   * @param {string} [input.justificacion]
   * @returns {Promise<object>}
   */
  async execute({ siteId, tenantId, fechaHoraPropuesta, justificacion = null }) {
    if (!siteId) throw new ValidationError('siteId es requerido', 'VALIDATION_ERROR');
    if (!tenantId) throw new ValidationError('tenantId es requerido', 'VALIDATION_ERROR');
    if (!fechaHoraPropuesta) throw new ValidationError('fechaHoraPropuesta es requerida', 'VALIDATION_ERROR');

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

    const evaluacion = rulesInstance.evaluateSchedule(fechaHoraPropuesta);

    let estadoValidacion;
    if (evaluacion.cumpleHorario) {
      estadoValidacion = 'APROBADO';
    } else if (justificacion && justificacion.trim().length >= 10) {
      estadoValidacion = 'APROBADO_CON_JUSTIFICACION';
    } else {
      estadoValidacion = 'REQUIERE_JUSTIFICACION';
    }

    return {
      siteId: site.id,
      nombreSitio: site.nombre,
      fechaHoraPropuesta,
      cumpleHorario: evaluacion.cumpleHorario,
      fueraDeHorario: evaluacion.fueraDeHorario,
      requiereJustificacion: evaluacion.requiereJustificacion,
      estadoValidacion,
      advertencia: evaluacion.advertencia,
      justificacionAportada: justificacion ? justificacion.trim() : null,
      horarioConfigurado: rulesInstance.horario,
    };
  }
}

module.exports = ValidateAllyScheduleUseCase;
