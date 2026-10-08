/**
 * Puerto de Dominio — frontera DECLARADA hacia el Rules Service (MANI-Java).
 *
 * US-03.1.1-M2.2: esta interfaz es SOLO el contrato. Define la forma en que
 * Core Node delegará la evaluación de reglas de negocio sobre una categoría
 * de servicio al Rules Service, pero NO implementa ningún adaptador HTTP
 * real todavía. La historia padre (US-03.1.1-M2) separó explícitamente:
 *   - "gestión de categoría"   → Core Node (implementado en US-03.1.1-M2.1)
 *   - "evaluación de reglas"   → Rules Service (declarado aquí; la
 *                                implementación real queda para una
 *                                historia futura, fuera de este alcance)
 *
 * Arquitectura de destino (ADR-0019, ya documentada en README.md):
 *   Flutter -> NGINX API Gateway (/api/v1/rules/*) -> MANI-Java (Rules)
 * Core Node consume MANI-Java como servicio interno (`config.rulesServiceUrl`,
 * p. ej. http://rules-service:8080) para validar reglas contextuales sobre
 * una categoría (p. ej.: ¿tiene tarifas o restricciones vigentes para este
 * tenant?) — nunca expone esa URL interna al cliente final, y el cliente
 * final nunca llama a MANI-Java directamente.
 *
 * Cuando se implemente (historia futura, fuera de alcance de M2.2):
 *   - Vivirá en `src/infrastructure/clients/RulesServiceHttpClient.js`,
 *     inyectado por constructor igual que `SupabaseClientFactory`
 *     (`{ baseUrl = config.rulesServiceUrl }`).
 *   - Hará una llamada HTTP real contra `${baseUrl}/api/v1/rules/...`; el
 *     contrato OpenAPI de ESE endpoint lo define MANI-Java/MANI-APIGateway,
 *     no este repo (mismo principio que CFG-16: el Gateway es dueño del
 *     contrato público, Core solo lo consume).
 *   - Envolverá errores de red/5xx en `DomainError('INTERNAL_ERROR', 500)`,
 *     igual que el resto de infraestructura de este repo.
 *   - Devolverá instancias de `RuleEvaluationResult`
 *     (`src/domain/entities/RuleEvaluationResult.js`), que ya documenta la
 *     forma de datos esperada.
 *
 * Hasta entonces, cualquier llamada real a este puerto DEBE fallar fuerte
 * (ver el throw de abajo) en vez de simular un resultado: así ningún caso de
 * uso puede depender silenciosamente de una evaluación de reglas que todavía
 * no existe de verdad.
 */
class IRuleEvaluationService {
  /**
   * @param {object} params
   * @param {string} params.tenantId
   * @param {string} params.categoryId - id de la categoría de servicio (US-03.1.1-M2.1) sobre la que se evalúan reglas.
   * @param {object} [params.context] - datos contextuales adicionales (p. ej. zona, fecha, tarifa propuesta) que el Rules Service necesite para decidir.
   * @returns {Promise<import('../entities/RuleEvaluationResult')>}
   */
  async evaluateCategoryRules(_params) {
    throw new Error(
      'IRuleEvaluationService.evaluateCategoryRules() es un contrato declarado (US-03.1.1-M2.2), ' +
        'sin implementación: la evaluación de reglas vive en el Rules Service (MANI-Java), no en Core Node.'
    );
  }
}

module.exports = IRuleEvaluationService;
