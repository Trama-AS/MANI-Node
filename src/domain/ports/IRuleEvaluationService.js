/**
 * Puerto de Dominio — frontera hacia el Rules Service (MANI-Java).
 *
 * Declarado en US-03.1.1-M2.2 e implementado en US-03.1.1-M6 por
 * `src/infrastructure/clients/RulesServiceHttpClient.js`, que llama
 * POST ${RULES_SERVICE_URL}/api/v1/rules/categories/evaluate por la red interna.
 * El contrato público lo publica MANI-APIGateway (docs/openapi/rules.yaml).
 *
 * Las reglas operativas de la categoría (longitud y letras del nombre, flujos
 * operativos permitidos, categoría activa) las decide Rules; Core solo valida
 * la forma de la petición y persiste. Así las reglas cambian sin desplegar Core.
 */
class IRuleEvaluationService {
  /**
   * @param {object} params
   * @param {string} params.tenantId - tenant de la sesión (claim del JWT), viaja como X-Tenant-Id.
   * @param {string|null} [params.categoryId] - null al crear.
   * @param {{ operation: 'CREATE'|'UPDATE'|'OPERATE', name?: string, flujoOperativo?: string, active?: boolean }} params.context
   * @param {string} params.role - rol de dominio de la sesión, viaja como X-User-Role.
   * @param {string} [params.correlationId]
   * @returns {Promise<import('../entities/RuleEvaluationResult')>}
   */
  async evaluateCategoryRules(_params) {
    throw new Error('IRuleEvaluationService.evaluateCategoryRules() no implementado');
  }
}

module.exports = IRuleEvaluationService;
