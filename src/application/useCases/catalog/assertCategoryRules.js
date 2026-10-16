const { RuleViolationError } = require('../../../domain/errors/DomainError');

/**
 * Delega las reglas operativas de la categoría al Rules Service y devuelve los
 * valores normalizados que decidió Rules. Si alguna regla no se cumple, lanza
 * RuleViolationError (400) con el detalle de cada violación.
 */
async function assertCategoryRules(ruleEvaluationService, { tenantId, categoryId = null, role, correlationId, context }) {
  const result = await ruleEvaluationService.evaluateCategoryRules({ tenantId, categoryId, role, correlationId, context });

  if (!result.allowed) {
    const detail = result.violations.map((v) => v.message).filter(Boolean).join('; ');
    throw new RuleViolationError(
      result.violations,
      detail ? `La categoría no cumple las reglas de negocio: ${detail}` : undefined
    );
  }

  return result.normalized;
}

module.exports = assertCategoryRules;
