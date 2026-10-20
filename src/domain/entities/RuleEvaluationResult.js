const { ValidationError } = require('../errors/DomainError');

/**
 * Forma del resultado que `IRuleEvaluationService.evaluateCategoryRules()`
 * deberá devolver una vez implementado (US-03.1.1-M2.2: contrato declarado,
 * SIN implementación todavía). Documenta la forma de datos esperada del
 * Rules Service (MANI-Java) para que, cuando exista, cualquier adaptador
 * HTTP real y cualquier caso de uso que lo consuma compartan la misma forma,
 * en vez de que cada implementación futura invente su propio shape.
 */
class RuleEvaluationResult {
  constructor({ allowed, ruleSetVersion, violations = [] }) {
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
