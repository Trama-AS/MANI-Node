const test = require('node:test');
const assert = require('node:assert/strict');
const RuleEvaluationResult = require('../../../src/domain/entities/RuleEvaluationResult');
const IRuleEvaluationService = require('../../../src/domain/ports/IRuleEvaluationService');
const { ValidationError } = require('../../../src/domain/errors/DomainError');

// US-03.1.1-M2.2: estas pruebas documentan el CONTRATO (forma de datos +
// comportamiento "no implementado") de la frontera hacia el Rules Service.
// No prueban ninguna integración real porque, a propósito, no existe
// ninguna todavía.

test('RuleEvaluationResult valida allowed/ruleSetVersion/violations', () => {
  assert.throws(() => new RuleEvaluationResult({ ruleSetVersion: 'v1' }), ValidationError); // falta allowed
  assert.throws(() => new RuleEvaluationResult({ allowed: true }), ValidationError); // falta ruleSetVersion
  assert.throws(
    () => new RuleEvaluationResult({ allowed: true, ruleSetVersion: 'v1', violations: 'no-es-array' }),
    ValidationError
  );

  const result = new RuleEvaluationResult({ allowed: false, ruleSetVersion: 'v1', violations: [{ code: 'X' }] });
  assert.deepEqual(result.toJSON(), {
    allowed: false,
    ruleSetVersion: 'v1',
    violations: [{ code: 'X' }],
  });
});

test('RuleEvaluationResult.violations por defecto es un arreglo vacío', () => {
  const result = new RuleEvaluationResult({ allowed: true, ruleSetVersion: 'v1' });
  assert.deepEqual(result.violations, []);
});

test('IRuleEvaluationService.evaluateCategoryRules() NO está implementado: siempre rechaza', async () => {
  const service = new IRuleEvaluationService();

  await assert.rejects(
    () => service.evaluateCategoryRules({ tenantId: 't1', categoryId: 'c1' }),
    (err) => {
      assert.match(err.message, /sin implementación/);
      assert.match(err.message, /Rules Service/);
      return true;
    }
  );
});
