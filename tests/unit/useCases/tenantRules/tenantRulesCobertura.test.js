const test = require('node:test');
const assert = require('node:assert/strict');

const TenantRulesUseCase = require('../../../../src/application/useCases/tenantRules/TenantRulesUseCase');
const InMemoryTenantRulesRepository = require('../../../../src/infrastructure/repositories/InMemoryTenantRulesRepository');
const { DomainError } = require('../../../../src/domain/errors/DomainError');

// SCRUM-1727 (QAS-23): cobertura de "reglas del tenant" sobre el comportamiento de SCRUM-1722 (Rules es el único que
// valida y Core guarda lo que Rules devuelve normalizado). Complementa tenantRulesUseCase.test.js, que cubre C1 a C3.

const TENANT_A = '11111111-1111-4111-8111-111111111111';
const TENANT_B = '22222222-2222-4222-8222-222222222222';
const ADMIN_A = { tenantId: TENANT_A, userId: 'aaaa1111-1111-4111-8111-111111111111', role: 'ADMIN' };
const CLIENTE_A = { tenantId: TENANT_A, userId: 'cccc1111-1111-4111-8111-111111111111', role: 'CLIENT' };
const ALIADO_A = { tenantId: TENANT_A, userId: 'bbbb1111-1111-4111-8111-111111111111', role: 'ALLY' };

const REGLAS = { comision: { porcentaje: 10 } };
const NORMALIZADAS = { comision: { porcentaje: 10 }, oferta: { minutosParaAceptar: 30 } };

function armar({ validar } = {}) {
  const repo = new InMemoryTenantRulesRepository();
  const recibidas = [];
  const motor = {
    validateTenantRules: async (args) => {
      recibidas.push(args);
      return validar ? validar(args) : { valid: true, rules: NORMALIZADAS };
    },
  };
  return { uc: new TenantRulesUseCase({ tenantRulesRepository: repo, ruleEvaluationService: motor }), repo, recibidas };
}
const actualizar = (uc, body, user = ADMIN_A, correlationId = 'corr-1') => uc.actualizar({ user, body, correlationId });
const versionVigente = async (repo, user = ADMIN_A) => (await repo.getVigente(user)).version;

test('SCRUM-1727: exige el repositorio y el motor de reglas', () => {
  assert.throws(() => new TenantRulesUseCase({ ruleEvaluationService: {} }), /tenantRulesRepository/);
  assert.throws(() => new TenantRulesUseCase({ tenantRulesRepository: {} }), /ruleEvaluationService/);
});

test('SCRUM-1727: Core guarda las reglas normalizadas que devuelve Rules, no las que envió el cliente', async () => {
  const { uc, repo } = armar();
  const guardada = await actualizar(uc, { expectedVersion: 0, reglas: REGLAS });
  assert.equal(guardada.version, 1);
  assert.deepEqual(guardada.reglas, NORMALIZADAS);
  assert.equal(await versionVigente(repo), 1);
});

test('SCRUM-1727: Rules recibe el tenant y el rol de la sesión (no del cuerpo), la correlación y las reglas tal cual', async () => {
  const { uc, recibidas } = armar();
  await actualizar(uc, { expectedVersion: 0, reglas: REGLAS, tenantId: TENANT_A }, { ...ADMIN_A, tenantId: TENANT_B }, 'corr-9');
  assert.equal(recibidas[0].tenantId, TENANT_B);
  assert.equal(recibidas[0].role, 'ADMIN');
  assert.equal(recibidas[0].correlationId, 'corr-9');
  assert.deepEqual(recibidas[0].rules, REGLAS);
});

test('SCRUM-1727: expectedVersion es obligatorio y debe ser un entero >= 0 (también como texto numérico)', async () => {
  const { uc, recibidas } = armar();
  for (const expectedVersion of [undefined, null]) {
    await assert.rejects(() => actualizar(uc, { expectedVersion, reglas: REGLAS }), /expectedVersion es obligatorio/);
  }
  for (const expectedVersion of [-1, 1.5, 'abc', NaN]) {
    await assert.rejects(() => actualizar(uc, { expectedVersion, reglas: REGLAS }), /entero >= 0/, String(expectedVersion));
  }
  assert.equal(recibidas.length, 0, 'sin versión válida no se consulta a Rules');
  assert.equal((await actualizar(uc, { expectedVersion: '0', reglas: REGLAS })).version, 1);
});

test('SCRUM-1727: reglas debe ser un objeto JSON; un arreglo, nulo o texto se rechaza sin consultar a Rules', async () => {
  const { uc, repo, recibidas } = armar();
  for (const reglas of [undefined, null, [], 'comision', 42]) {
    await assert.rejects(() => actualizar(uc, { expectedVersion: 0, reglas }), /reglas debe ser un objeto JSON/);
  }
  assert.equal(recibidas.length, 0);
  assert.equal(await versionVigente(repo), 0);
});

test('SCRUM-1727: si Rules rechaza las reglas (RULES_VALIDATION_ERROR) es un error del dominio MANI-RGL y no se guarda nada', async () => {
  const { uc, repo } = armar({
    validar: () => {
      throw new DomainError('comisión fuera de rango', 'RULES_VALIDATION_ERROR', 422);
    },
  });
  await assert.rejects(
    () => actualizar(uc, { expectedVersion: 0, reglas: REGLAS }),
    (e) => /^MANI-RGL/.test(e.code) && /comisión fuera de rango/.test(e.message) && e.statusCode >= 400 && e.statusCode < 500
  );
  assert.equal(await versionVigente(repo), 0);
});

test('SCRUM-1727: si Rules no responde (503) falla cerrado con MANI-RGL-503 y no se guarda nada', async () => {
  const { uc, repo } = armar({
    validar: () => {
      throw new DomainError('Servicio de reglas no disponible', 'RULES_SERVICE_UNAVAILABLE', 503);
    },
  });
  await assert.rejects(() => actualizar(uc, { expectedVersion: 0, reglas: REGLAS }), (e) => e.code === 'MANI-RGL-503' && e.statusCode === 503);
  assert.equal(await versionVigente(repo), 0);
});

test('SCRUM-1727: cualquier otro error de Rules se informa como 502 MANI-RGL-502 con su causa', async () => {
  const { uc } = armar({
    validar: () => {
      throw new DomainError('respuesta ilegible', 'RULES_BAD_GATEWAY', 500);
    },
  });
  await assert.rejects(() => actualizar(uc, { expectedVersion: 0, reglas: REGLAS }), (e) => e.code === 'MANI-RGL-502' && e.statusCode === 502 && /respuesta ilegible/.test(e.message));
});

test('SCRUM-1727: un error que no es del dominio (un fallo del programa) se propaga tal cual y no se disfraza', async () => {
  const { uc, repo } = armar({
    validar: () => {
      throw new TypeError('bug inesperado');
    },
  });
  await assert.rejects(() => actualizar(uc, { expectedVersion: 0, reglas: REGLAS }), TypeError);
  assert.equal(await versionVigente(repo), 0);
});

test('SCRUM-1727: si Rules aprueba sin devolver las reglas normalizadas es 502 y no se guarda nada', async () => {
  for (const respuesta of [undefined, null, { valid: true }, { valid: true, rules: null }, { valid: true, rules: [] }]) {
    const { uc, repo } = armar({ validar: () => respuesta });
    await assert.rejects(() => actualizar(uc, { expectedVersion: 0, reglas: REGLAS }), (e) => e.code === 'MANI-RGL-502' && /sin devolverlas normalizadas/.test(e.message));
    assert.equal(await versionVigente(repo), 0);
  }
});

test('SCRUM-1727: solo el administrador del tenant actualiza; cliente, aliado y sin sesión no llegan a Rules', async () => {
  const { uc, recibidas } = armar();
  for (const user of [CLIENTE_A, ALIADO_A]) {
    await assert.rejects(() => actualizar(uc, { expectedVersion: 0, reglas: REGLAS }, user), (e) => e.statusCode === 403);
  }
  await assert.rejects(() => actualizar(uc, { expectedVersion: 0, reglas: REGLAS }, null), (e) => [401, 403].includes(e.statusCode));
  assert.equal(recibidas.length, 0);
});

test('SCRUM-1727: el historial es solo del administrador; la versión vigente la leen administrador, cliente y aliado', async () => {
  const { uc } = armar();
  await assert.doesNotReject(() => uc.consultarHistorial({ user: ADMIN_A }));
  for (const user of [CLIENTE_A, ALIADO_A]) {
    await assert.rejects(() => uc.consultarHistorial({ user }), (e) => e.statusCode === 403);
    assert.equal((await uc.consultarVigente({ user })).version, 0);
  }
  await assert.rejects(() => uc.consultarVigente({ user: null }), (e) => [401, 403].includes(e.statusCode));
});
