const { SiteRules } = require('../domain/SiteRules');

/**
 * Caso de Uso: Validar Agenda Propuesta por el Aliado contra Reglas del Sitio
 * (SCRUM-853 / US-02.2.3 / RF-09)
 *
 * Criterio de Aceptación (BDD Scenario 2):
 * Given horario permitido de 8:00 a 17:00,
 * When el aliado intenta agendar a las 19:00,
 * Then el sistema muestra advertencia y solicita justificación operativa.
 */
class ValidateAllyScheduleUseCase {
  /**
   * @param {import('./ICompanyClientRepository').ICompanyClientRepository} repository
   */
  constructor(repository) {
    if (!repository) throw new Error('repository es requerido en ValidateAllyScheduleUseCase');
    this.repository = repository;
  }

  /**
   * @param {object} input
   * @param {string} input.siteId
   * @param {string} input.tenantId
   * @param {string|Date} input.fechaHoraPropuesta - ISO String o fecha (ej: "2026-10-15T19:00:00")
   * @param {string} [input.justificacion]        - Justificación opcional si es fuera de horario
   * @param {string} [input.correlationId]
   * @returns {Promise<object>}
   */
  async execute({ siteId, tenantId, fechaHoraPropuesta, justificacion = null, correlationId = 'none' }) {
    if (!siteId) throw new Error('siteId es requerido');
    if (!tenantId) throw new Error('tenantId es requerido');
    if (!fechaHoraPropuesta) throw new Error('fechaHoraPropuesta es requerida');

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

    const evaluacion = rulesInstance.evaluateSchedule(fechaHoraPropuesta);

    let estadoValidacion;
    if (evaluacion.cumpleHorario) {
      estadoValidacion = 'APROBADO';
    } else if (justificacion && justificacion.trim().length >= 10) {
      estadoValidacion = 'APROBADO_CON_JUSTIFICACION';
    } else {
      estadoValidacion = 'REQUIERE_JUSTIFICACION';
    }

    console.log(
      `[ValidateAllyScheduleUseCase] Evaluación horario para sitio "${siteId}": ${estadoValidacion}. Corr: ${correlationId}`
    );

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

module.exports = { ValidateAllyScheduleUseCase };
