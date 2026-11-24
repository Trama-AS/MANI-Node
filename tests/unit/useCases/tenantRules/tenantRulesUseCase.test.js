const test = require('node:test');
const assert = require('node:assert/strict');

const TenantRulesUseCase = require('../../../../src/application/useCases/tenantRules/TenantRulesUseCase');
const InMemoryTenantRulesRepository = require('../../../../src/infrastructure/repositories/InMemoryTenantRulesRepository');
const { REGLAS_POR_OMISION } = require('../../../../src/domain/rules/tenantRulesDefaults');
const { DomainError } = require('../../../../src/domain/errors/DomainError');

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const ADMIN_A = { tenantId: TENANT_A, userId: 'aaaa1111-1111-4111-8111-111111111111', role: 'ADMIN' };
const CLIENTE_A = { tenantId: TENANT_A, userId: 'cccc1111-1111-4111-8111-111111111111', role: 'CLIENT' };
const ALIADO_A = { tenantId: TENANT_A, userId: 'bbbb1111-1111-4111-8111-111111111111', role: 'ALLY' };

/**
 * Doble de Rules con el contrato de POST /api/v1/rules/tenant-rules/validate (SCRUM-1722): si las reglas son
 * válidas devuelve `rules` normalizadas; si no, el cliente HTTP lanza RULES_VALIDATION_ERROR (422).
 */
function fakeRulesService({ shouldFail503 = false, violations = null, sinReglas = false } = {}) {
  const recibidas = [];
  return {
    recibidas,
    async validateTenantRules({ rules }) {
      recibidas.push(rules);
      if (shouldFail503) {
        throw new DomainError('Servicio de reglas no disponible', 'RULES_SERVICE_UNAVAILABLE', 503);
      }
      if (violations) {
        throw new DomainError(`Reglas de tenant incompatibles: ${violations.join(', ')}`, 'RULES_VALIDATION_ERROR', 422);
      }
      if (sinReglas) return { valid: true, version: 'tenant-rules-v1', violations: [] };
      const normalizadas = {
        ...rules,
        ordenListado: { criterio: String(rules.ordenListado.criterio).trim().toUpperCase() },
      };
      return { valid: true, version: 'tenant-rules-v1', violations: [], rules: normalizadas };
    },
  };
}

const REGLAS_VALIDAS = {
  ordenListado: { criterio: 'COBERTURA' },
  alertaTarifa: { toleranciaPorcentaje: 15 },
  comision: { porcentaje: 10 },
  cancelacion: { ventanaHoras: 4, penalizacionPorcentaje: 25 },
  oferta: { minutosParaAceptar: 30 },
};

test('C1: Consulta versión vigente devuelve POR_OMISION (version 0) cuando no hay configuración previa', async () => {
  const repo = new InMemoryTenantRulesRepository();
  const uc = new TenantRulesUseCase({ tenantRulesRepository: repo, ruleEvaluationService: fakeRulesService() });

  const r = await uc.consultarVigente({ user: ADMIN_A });
  assert.equal(r.version, 0);
  assert.equal(r.origen, 'POR_OMISION');
  assert.deepEqual(r.reglas, REGLAS_POR_OMISION);
});

test('C1: Administrador configura versión 1 con expectedVersion=0 y queda VIGENTE y auditada', async () => {
  const repo = new InMemoryTenantRulesRepository();
  const uc = new TenantRulesUseCase({ tenantRulesRepository: repo, ruleEvaluationService: fakeRulesService() });

  const guardada = await uc.actualizar({
    user: ADMIN_A,
    body: { expectedVersion: 0, reglas: REGLAS_VALIDAS },
    correlationId: 'corr-01',
  });

  assert.equal(guardada.version, 1);
  assert.equal(guardada.origen, 'PROPIO');
  assert.equal(guardada.estado, 'VIGENTE');
  assert.equal(guardada.reglas.ordenListado.criterio, 'COBERTURA');
  assert.equal(guardada.auditoria.creadoPor, ADMIN_A.userId);
  assert.equal(guardada.auditoria.actorRol, 'ADMIN');
  assert.equal(guardada.auditoria.correlationId, 'corr-01');

  // Consulta vigente ahora devuelve la v1
  const vigente = await uc.consultarVigente({ user: ADMIN_A });
  assert.equal(vigente.version, 1);
  assert.equal(vigente.origen, 'PROPIO');
  assert.equal(vigente.reglas.ordenListado.criterio, 'COBERTURA');
});

test('C1: Administrador actualiza a versión 2 (expectedVersion=1); la v1 pasa a HISTORICA y el historial conserva ambas', async () => {
  const repo = new InMemoryTenantRulesRepository();
  const uc = new TenantRulesUseCase({ tenantRulesRepository: repo, ruleEvaluationService: fakeRulesService() });

  await uc.actualizar({ user: ADMIN_A, body: { expectedVersion: 0, reglas: REGLAS_VALIDAS } });

  const reglasV2 = {
    ...REGLAS_VALIDAS,
    comision: { porcentaje: 20 },
  };

  const v2 = await uc.actualizar({
    user: ADMIN_A,
    body: { expectedVersion: 1, reglas: reglasV2 },
    correlationId: 'corr-02',
  });
  assert.equal(v2.version, 2);
  assert.equal(v2.reglas.comision.porcentaje, 20);

  const historial = await uc.consultarHistorial({ user: ADMIN_A });
  assert.equal(historial.length, 2);
  assert.equal(historial[0].version, 2);
  assert.equal(historial[0].estado, 'VIGENTE');
  assert.equal(historial[1].version, 1);
  assert.equal(historial[1].estado, 'HISTORICA');
});

test('C2: Rechaza expectedVersion desactualizada con 409 MANI-RGL-409C y no modifica la versión vigente', async () => {
  const repo = new InMemoryTenantRulesRepository();
  const uc = new TenantRulesUseCase({ tenantRulesRepository: repo, ruleEvaluationService: fakeRulesService() });

  await uc.actualizar({ user: ADMIN_A, body: { expectedVersion: 0, reglas: REGLAS_VALIDAS } });

  await assert.rejects(
    () => uc.actualizar({ user: ADMIN_A, body: { expectedVersion: 0, reglas: REGLAS_VALIDAS } }),
    (err) => err.statusCode === 409 && err.code === 'MANI-RGL-409C'
  );

  const vigente = await uc.consultarVigente({ user: ADMIN_A });
  assert.equal(vigente.version, 1);
});

test('C3: Clientes y Aliados no pueden actualizar reglas (403 MANI-RGL-403)', async () => {
  const repo = new InMemoryTenantRulesRepository();
  const uc = new TenantRulesUseCase({ tenantRulesRepository: repo, ruleEvaluationService: fakeRulesService() });

  await assert.rejects(
    () => uc.actualizar({ user: CLIENTE_A, body: { expectedVersion: 0, reglas: REGLAS_VALIDAS } }),
    (err) => err.statusCode === 403 && err.code === 'MANI-RGL-403'
  );

  await assert.rejects(
    () => uc.actualizar({ user: ALIADO_A, body: { expectedVersion: 0, reglas: REGLAS_VALIDAS } }),
    (err) => err.statusCode === 403 && err.code === 'MANI-RGL-403'
  );

  // Clientes y Aliados SÍ pueden consultar la versión vigente
  const vigCliente = await uc.consultarVigente({ user: CLIENTE_A });
  assert.equal(vigCliente.version, 0);

  const vigAliado = await uc.consultarVigente({ user: ALIADO_A });
  assert.equal(vigAliado.version, 0);
});

test('C3: Aislamiento entre tenants: configurar reglas en Tenant A no afecta al Tenant B', async () => {
  const repo = new InMemoryTenantRulesRepository();
  const uc = new TenantRulesUseCase({ tenantRulesRepository: repo, ruleEvaluationService: fakeRulesService() });

  await uc.actualizar({ user: ADMIN_A, body: { expectedVersion: 0, reglas: REGLAS_VALIDAS } });

  const vigA = await uc.consultarVigente({ user: ADMIN_A });
  assert.equal(vigA.version, 1);
  assert.equal(vigA.origen, 'PROPIO');

  const adminB = { tenantId: TENANT_B, userId: 'bbbb2222-2222-4222-8222-222222222222', role: 'ADMIN' };
  const vigB = await uc.consultarVigente({ user: adminB });
  assert.equal(vigB.version, 0);
  assert.equal(vigB.origen, 'POR_OMISION');
});

// SCRUM-1722 / QAS-21: Rules es el único que valida las reglas del tenant. Core no tiene copia local de los límites.

test('SCRUM-1722: Core envía las reglas tal como llegan y guarda las normalizadas que devuelve Rules', async () => {
  const repo = new InMemoryTenantRulesRepository();
  const rules = fakeRulesService();
  const uc = new TenantRulesUseCase({ tenantRulesRepository: repo, ruleEvaluationService: rules });

  const enviadas = { ...REGLAS_VALIDAS, ordenListado: { criterio: ' cobertura ' } };
  const guardada = await uc.actualizar({ user: ADMIN_A, body: { expectedVersion: 0, reglas: enviadas } });

  assert.deepEqual(rules.recibidas[0], enviadas, 'Core no normaliza ni recorta antes de preguntar a Rules');
  assert.equal(guardada.reglas.ordenListado.criterio, 'COBERTURA');
});

test('SCRUM-1722 / C2: unas reglas que Rules rechaza son 400 MANI-RGL-400 con sus violaciones y no se guardan', async () => {
  const repo = new InMemoryTenantRulesRepository();
  const uc = new TenantRulesUseCase({
    tenantRulesRepository: repo,
    ruleEvaluationService: fakeRulesService({ violations: ['comision.porcentaje debe ser un número entre 0 y 30, con máximo 2 decimales'] }),
  });

  await assert.rejects(
    () => uc.actualizar({ user: ADMIN_A, body: { expectedVersion: 0, reglas: { ...REGLAS_VALIDAS, comision: { porcentaje: 10.555 } } } }),
    (err) => err.statusCode === 400 && err.code === 'MANI-RGL-400' && err.message.includes('comision.porcentaje')
  );
  assert.equal((await repo.getVigente(ADMIN_A)).version, 0);
});

test('SCRUM-1722 / T2: si Rules no responde es 503 MANI-RGL-503, sin regla local de respaldo ni cambios', async () => {
  const repo = new InMemoryTenantRulesRepository();
  const uc = new TenantRulesUseCase({ tenantRulesRepository: repo, ruleEvaluationService: fakeRulesService({ shouldFail503: true }) });

  await assert.rejects(
    () => uc.actualizar({ user: ADMIN_A, body: { expectedVersion: 0, reglas: REGLAS_VALIDAS } }),
    (err) => err.statusCode === 503 && err.code === 'MANI-RGL-503'
  );
  assert.equal((await repo.getVigente(ADMIN_A)).version, 0);
});

test('SCRUM-1722: si Rules aprueba sin devolver las reglas normalizadas es 502 MANI-RGL-502 y no se guarda', async () => {
  const repo = new InMemoryTenantRulesRepository();
  const uc = new TenantRulesUseCase({ tenantRulesRepository: repo, ruleEvaluationService: fakeRulesService({ sinReglas: true }) });

  await assert.rejects(
    () => uc.actualizar({ user: ADMIN_A, body: { expectedVersion: 0, reglas: REGLAS_VALIDAS } }),
    (err) => err.statusCode === 502 && err.code === 'MANI-RGL-502'
  );
  assert.equal((await repo.getVigente(ADMIN_A)).version, 0);
});

test('SCRUM-1722: cualquier otra falla de integración con Rules es 502 MANI-RGL-502', async () => {
  const uc = new TenantRulesUseCase({
    tenantRulesRepository: new InMemoryTenantRulesRepository(),
    ruleEvaluationService: {
      async validateTenantRules() {
        throw new DomainError('El servicio de reglas rechazó la petición (400 TENANT_REQUIRED)', 'RULES_SERVICE_ERROR', 502);
      },
    },
  });
  await assert.rejects(
    () => uc.actualizar({ user: ADMIN_A, body: { expectedVersion: 0, reglas: REGLAS_VALIDAS } }),
    (err) => err.statusCode === 502 && err.code === 'MANI-RGL-502' && err.message.includes('TENANT_REQUIRED')
  );
});

test('SCRUM-1722: un error que no es del dominio se propaga tal cual', async () => {
  const boom = new TypeError('fallo inesperado');
  const uc = new TenantRulesUseCase({
    tenantRulesRepository: new InMemoryTenantRulesRepository(),
    ruleEvaluationService: { validateTenantRules: async () => { throw boom; } },
  });
  await assert.rejects(() => uc.actualizar({ user: ADMIN_A, body: { expectedVersion: 0, reglas: REGLAS_VALIDAS } }), boom);
});

test('la forma de la petición la valida Core: reglas que no son objeto o expectedVersion inválido son 400 sin llamar a Rules', async () => {
  const rules = fakeRulesService();
  const uc = new TenantRulesUseCase({ tenantRulesRepository: new InMemoryTenantRulesRepository(), ruleEvaluationService: rules });

  for (const reglas of [null, 'reglas', [REGLAS_VALIDAS], 15, undefined]) {
    await assert.rejects(
      () => uc.actualizar({ user: ADMIN_A, body: { expectedVersion: 0, reglas } }),
      (err) => err.statusCode === 400 && err.code === 'MANI-RGL-400' && err.message.includes('reglas debe ser un objeto')
    );
  }
  await assert.rejects(() => uc.actualizar({ user: ADMIN_A, body: { reglas: REGLAS_VALIDAS } }), /expectedVersion es obligatorio/);
  await assert.rejects(() => uc.actualizar({ user: ADMIN_A, body: { expectedVersion: -1, reglas: REGLAS_VALIDAS } }), /entero >= 0/);
  assert.equal(rules.recibidas.length, 0);
});
