const test = require('node:test');
const assert = require('node:assert/strict');
const RuleEvaluationResult = require('../../../src/domain/entities/RuleEvaluationResult');
const IRuleEvaluationService = require('../../../src/domain/ports/IRuleEvaluationService');
const { ValidationError } = require('../../../src/domain/errors/DomainError');

// Contrato de la frontera hacia el Rules Service (declarado en US-03.1.1-M2.2,
// implementado en US-03.1.1-M6 por RulesServiceHttpClient).

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

test('IRuleEvaluationService es un puerto abstracto: el puerto base siempre rechaza', async () => {
  const service = new IRuleEvaluationService();

  await assert.rejects(
    () => service.evaluateCategoryRules({ tenantId: 't1', categoryId: 'c1' }),
    /no implementado/
  );
});

test('RuleEvaluationResult conserva normalized de Rules sin cambiar toJSON()', () => {
  const result = new RuleEvaluationResult({
    allowed: true,
    ruleSetVersion: 'v1',
    normalized: { name: 'Plomería', flujoOperativo: 'TARIFA_ESTANDAR' },
  });
  assert.deepEqual(result.normalized, { name: 'Plomería', flujoOperativo: 'TARIFA_ESTANDAR' });
  assert.deepEqual(new RuleEvaluationResult({ allowed: true, ruleSetVersion: 'v1' }).normalized, {});
  assert.deepEqual(Object.keys(result.toJSON()), ['allowed', 'ruleSetVersion', 'violations']);
});
