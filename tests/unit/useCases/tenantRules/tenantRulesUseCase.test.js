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

function fakeRulesService({ shouldFail503 = false, shouldFail422 = false } = {}) {
  return {
    async validateTenantRules() {
      if (shouldFail503) {
        throw new DomainError('Servicio de reglas no disponible', 'RULES_SERVICE_UNAVAILABLE', 503);
      }
      if (shouldFail422) {
        throw new DomainError('Reglas de tenant incompatibles', 'RULES_VALIDATION_ERROR', 422);
      }
      return { valid: true };
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

test('C2: Rechaza reglas con criterios inválidos o fuera de rango con 400 sin alterar nada', async () => {
  const repo = new InMemoryTenantRulesRepository();
  const uc = new TenantRulesUseCase({ tenantRulesRepository: repo, ruleEvaluationService: fakeRulesService() });

  // Criterio de orden inválido
  await assert.rejects(
    () => uc.actualizar({ user: ADMIN_A, body: { expectedVersion: 0, reglas: { ...REGLAS_VALIDAS, ordenListado: { criterio: 'PRECIO' } } } }),
    /MANI-RGL-400/
  );

  // Tolerancia > 50 %
  await assert.rejects(
    () => uc.actualizar({ user: ADMIN_A, body: { expectedVersion: 0, reglas: { ...REGLAS_VALIDAS, alertaTarifa: { toleranciaPorcentaje: 60 } } } }),
    /MANI-RGL-400/
  );

  // Comisión > 30 %
  await assert.rejects(
    () => uc.actualizar({ user: ADMIN_A, body: { expectedVersion: 0, reglas: { ...REGLAS_VALIDAS, comision: { porcentaje: 35 } } } }),
    /MANI-RGL-400/
  );

  // Comisión con más de 2 decimales: la liquidación solo guarda 2 y el desglose no cuadraría
  await assert.rejects(
    () => uc.actualizar({ user: ADMIN_A, body: { expectedVersion: 0, reglas: { ...REGLAS_VALIDAS, comision: { porcentaje: 10.555 } } } }),
    /MANI-RGL-400/
  );

  // Penalización > 0 con ventana = 0
  await assert.rejects(
    () => uc.actualizar({ user: ADMIN_A, body: { expectedVersion: 0, reglas: { ...REGLAS_VALIDAS, cancelacion: { ventanaHoras: 0, penalizacionPorcentaje: 20 } } } }),
    /MANI-RGL-400/
  );

  // Minutos para aceptar < 1
  await assert.rejects(
    () => uc.actualizar({ user: ADMIN_A, body: { expectedVersion: 0, reglas: { ...REGLAS_VALIDAS, oferta: { minutosParaAceptar: 0 } } } }),
    /MANI-RGL-400/
  );
});

test('T2 / C2: Si Rules rechaza (422) o no responde (503), falla cerrado sin persistir nada', async () => {
  const repo = new InMemoryTenantRulesRepository();
  const uc503 = new TenantRulesUseCase({ tenantRulesRepository: repo, ruleEvaluationService: fakeRulesService({ shouldFail503: true }) });

  await assert.rejects(
    () => uc503.actualizar({ user: ADMIN_A, body: { expectedVersion: 0, reglas: REGLAS_VALIDAS } }),
    (err) => err.statusCode === 503 && err.code === 'RULES_SERVICE_UNAVAILABLE'
  );

  const uc422 = new TenantRulesUseCase({ tenantRulesRepository: repo, ruleEvaluationService: fakeRulesService({ shouldFail422: true }) });
  await assert.rejects(
    () => uc422.actualizar({ user: ADMIN_A, body: { expectedVersion: 0, reglas: REGLAS_VALIDAS } }),
    (err) => err.statusCode === 422 && err.code === 'RULES_VALIDATION_ERROR'
  );

  const vigente = await uc503.consultarVigente({ user: ADMIN_A });
  assert.equal(vigente.version, 0);
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

// Revisión de QA (C2): los valores deben ser números JSON. `Number()` convertía null, true, "", "15" y [] en 0, 1 o 15
// y se guardaban; ahora cada uno es 400 y no se llega a Rules ni al repositorio.
const NO_NUMERICOS = [
  ['null', null],
  ['true', true],
  ['false', false],
  ['cadena vacía', ''],
  ['cadena con número', '15'],
  ['arreglo vacío', []],
  ['arreglo con número', [15]],
  ['objeto', { valor: 15 }],
  ['NaN', Number.NaN],
  ['ausente', undefined],
];
const CAMPOS_NUMERICOS = [
  ['alertaTarifa', 'toleranciaPorcentaje'],
  ['comision', 'porcentaje'],
  ['cancelacion', 'ventanaHoras'],
  ['cancelacion', 'penalizacionPorcentaje'],
  ['oferta', 'minutosParaAceptar'],
];

for (const [seccion, campo] of CAMPOS_NUMERICOS) {
  for (const [nombre, valor] of NO_NUMERICOS) {
    test(`C2: ${seccion}.${campo} = ${nombre} se rechaza con 400 MANI-RGL-400 sin guardar ni llamar a Rules`, async () => {
      const repo = new InMemoryTenantRulesRepository();
      let llamadasRules = 0;
      const uc = new TenantRulesUseCase({
        tenantRulesRepository: repo,
        ruleEvaluationService: { validateTenantRules: async () => { llamadasRules += 1; return { valid: true }; } },
      });
      const reglas = { ...REGLAS_VALIDAS, [seccion]: { ...REGLAS_VALIDAS[seccion], [campo]: valor } };
      await assert.rejects(
        () => uc.actualizar({ user: ADMIN_A, body: { expectedVersion: 0, reglas } }),
        (err) => err.statusCode === 400 && err.code === 'MANI-RGL-400' && err.message.includes(`${seccion}.${campo}`)
      );
      assert.equal(llamadasRules, 0);
      assert.equal((await repo.getVigente(ADMIN_A)).version, 0);
    });
  }
}

test('C2: el criterio de orden debe ser texto; un número, null o un arreglo se rechazan', async () => {
  const uc = new TenantRulesUseCase({ tenantRulesRepository: new InMemoryTenantRulesRepository(), ruleEvaluationService: fakeRulesService() });
  for (const criterio of [1, null, ['COBERTURA'], true]) {
    await assert.rejects(
      () => uc.actualizar({ user: ADMIN_A, body: { expectedVersion: 0, reglas: { ...REGLAS_VALIDAS, ordenListado: { criterio } } } }),
      (err) => err.statusCode === 400 && err.message.includes('ordenListado.criterio')
    );
  }
});

test('C2: los límites numéricos son inclusivos y el criterio se normaliza', async () => {
  const uc = new TenantRulesUseCase({ tenantRulesRepository: new InMemoryTenantRulesRepository(), ruleEvaluationService: fakeRulesService() });
  const r = await uc.actualizar({
    user: ADMIN_A,
    body: {
      expectedVersion: 0,
      reglas: {
        ordenListado: { criterio: ' calificacion ' },
        alertaTarifa: { toleranciaPorcentaje: 50 },
        comision: { porcentaje: 0 },
        cancelacion: { ventanaHoras: 72, penalizacionPorcentaje: 100 },
        oferta: { minutosParaAceptar: 1440 },
      },
    },
  });
  assert.equal(r.reglas.ordenListado.criterio, 'CALIFICACION');
  await assert.rejects(
    () => uc.actualizar({ user: ADMIN_A, body: { expectedVersion: 1, reglas: { ...REGLAS_VALIDAS, oferta: { minutosParaAceptar: 1.5 } } } }),
    (err) => err.statusCode === 400 && err.message.includes('oferta.minutosParaAceptar')
  );
});
