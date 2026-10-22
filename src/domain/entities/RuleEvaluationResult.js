const { ValidationError } = require('../errors/DomainError');

/**
 * Resultado de `IRuleEvaluationService.evaluateCategoryRules()`: la forma que
 * devuelve el Rules Service (MANI-Java, POST /api/v1/rules/categories/evaluate).
 * `normalized` trae el nombre y el flujo tal como deben persistirse, para que
 * Core no reimplemente la normalización que decide Rules.
 */
class RuleEvaluationResult {
  constructor({ allowed, ruleSetVersion, violations = [], normalized = null }) {
    if (typeof allowed !== 'boolean') {
      throw new ValidationError('RuleEvaluationResult.allowed es requerido y debe ser booleano');
    }
    if (!ruleSetVersion || typeof ruleSetVersion !== 'string') {
      throw new ValidationError('RuleEvaluationResult.ruleSetVersion es requerido');
    }
    if (!Array.isArray(violations)) {
      throw new ValidationError('RuleEvaluationResult.violations debe ser un arreglo');
    }

    this.allowed = allowed;
    this.ruleSetVersion = ruleSetVersion;
    this.violations = violations;
    this.normalized = normalized || {};
  }

  toJSON() {
    return {
      allowed: this.allowed,
      ruleSetVersion: this.ruleSetVersion,
      violations: this.violations,
    };
  }
}

module.exports = RuleEvaluationResult;
