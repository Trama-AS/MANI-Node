const { dominio } = require('../sesionDeDominio');
const { validarReglasOperativas } = require('../../../domain/rules/tenantRulesDefaults');

const { invalido, sesion } = dominio('MANI-RGL');

const ROLES_LECTURA_VIGENTE = [
  'ADMIN',
  'ADMIN_TENANT',
  'ALLY',
  'CLIENT',
  'ADMIN_PLATAFORMA',
  'PLATFORM_ADMIN',
  'EMPLEADO_DIRECTO'
];

/**
 * Caso de uso: Reglas operativas propias por tenant (SCRUM-1366 / HU-M01-03).
 *
 * C1: Administrador configura reglas propias y consulta versión vigente.
 * C2: Valores inválidos o reglas incompatibles se rechazan sin modificar la configuración vigente.
 * C3: Usuarios comunes u otros tenants no pueden modificar las reglas.
 * T2: Validación con Rules; si Rules no responde, falla cerrado con 503 RULES_SERVICE_UNAVAILABLE.
 * T10: Registro auditado del actor con JWT y correlación.
 */
class TenantRulesUseCase {
  constructor({ tenantRulesRepository, ruleEvaluationService }) {
    if (!tenantRulesRepository) {
      throw new Error('tenantRulesRepository es requerido para TenantRulesUseCase');
    }
    if (!ruleEvaluationService) {
      throw new Error('ruleEvaluationService es requerido para TenantRulesUseCase');
    }
    this.tenantRulesRepository = tenantRulesRepository;
    this.ruleEvaluationService = ruleEvaluationService;
  }

  async consultarVigente({ user }) {
    const ctx = sesion(user, ROLES_LECTURA_VIGENTE, 'sesión no autorizada');
    return this.tenantRulesRepository.getVigente(ctx);
  }

  async consultarHistorial({ user }) {
    const ctx = sesion(user, ['ADMIN', 'ADMIN_TENANT', 'ADMIN_PLATAFORMA', 'PLATFORM_ADMIN'], 'solo el administrador del tenant consulta el historial de reglas');
    return this.tenantRulesRepository.getHistorial(ctx);
  }

  async actualizar({ user, body = {}, correlationId = null }) {
    const ctx = sesion(user, ['ADMIN', 'ADMIN_TENANT'], 'solo el administrador del tenant configura las reglas operativas');

    if (body.expectedVersion === undefined || body.expectedVersion === null) {
      throw invalido('expectedVersion es obligatorio');
    }
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
      throw invalido('expectedVersion debe ser un entero >= 0');
    }

    const normalized = validarReglasOperativas(body.reglas, invalido);

    // Validación contra el motor Rules (T2 / C2)
    await this.ruleEvaluationService.validateTenantRules({
      tenantId: ctx.tenantId,
      role: ctx.role,
      correlationId,
      rules: normalized
    });

    return this.tenantRulesRepository.saveNuevaVersion(ctx, { expectedVersion, reglas: normalized, correlationId });
  }
}

module.exports = TenantRulesUseCase;
