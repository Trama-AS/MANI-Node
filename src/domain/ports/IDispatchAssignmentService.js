/**
 * Puerto: asignaciones del aliado en MANI-Dispatch (SCRUM-853, criterio T1).
 * Los estados de asignación son dominio de Dispatch (SAD §7): Core los consulta por HTTP y no los lee de la tabla.
 */
class IDispatchAssignmentService {
  /**
   * Ids de las solicitudes asignadas al aliado autenticado, en su tenant y sin las canceladas.
   * @param {object} params
   * @param {string} params.authorization - Encabezado Authorization del aliado (se reenvía tal cual)
   * @param {string} [params.correlationId]
   * @returns {Promise<string[]>}
   * @throws {import('../errors/DomainError').DomainError} 503 si Dispatch no responde (criterio T2)
   */
  async listMyAssignedRequestIds(_params) {
    throw new Error('Método listMyAssignedRequestIds() no implementado.');
  }
}

module.exports = IDispatchAssignmentService;
