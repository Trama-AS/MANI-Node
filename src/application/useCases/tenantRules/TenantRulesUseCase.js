const { dominio } = require('../sesionDeDominio');
const { DomainError } = require('../../../domain/errors/DomainError');

const { invalido, sesion } = dominio('MANI-RGL');

const esObjeto = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Traduce lo que responde Rules al formato de errores del dominio (`MANI-RGL-NNN`, T5). Core no tiene una regla local
 * de respaldo (SCRUM-1722 / QAS-21): si Rules rechaza, falla o no responde, no se guarda nada.
 */
function errorDeRules(err) {
  if (!(err instanceof DomainError)) throw err;
  if (err.code === 'RULES_VALIDATION_ERROR') {
    // Reglas inválidas o incompatibles: el administrador puede corregirlas (C2), como cualquier 400 del dominio.
    return invalido(err.message);
  }
  if (err.statusCode === 503) {
    return new DomainError(
      'MANI-RGL-503: el motor de reglas no está disponible; no se guardaron las reglas',
      'MANI-RGL-503',
      503
    );
  }
  return new DomainError(`MANI-RGL-502: ${err.message}`, 'MANI-RGL-502', 502);
}

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
 * T2: Rules es el único que valida las reglas (SCRUM-1722 / QAS-21) y Core guarda las normalizadas que devuelve. Si
 *     Rules no responde, falla cerrado con 503 MANI-RGL-503 y no aplica ninguna regla local.
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

    // La forma de la petición es de Core; el contenido de las reglas lo decide Rules (T2 / C2).
    if (!esObjeto(body.reglas)) {
      throw invalido('reglas debe ser un objeto JSON');
    }

    let respuesta;
    try {
      respuesta = await this.ruleEvaluationService.validateTenantRules({
        tenantId: ctx.tenantId,
        role: ctx.role,
        correlationId,
        rules: body.reglas
      });
    } catch (err) {
      throw errorDeRules(err);
    }
    if (!respuesta || !esObjeto(respuesta.rules)) {
      throw new DomainError(
        'MANI-RGL-502: el motor de reglas aprobó las reglas sin devolverlas normalizadas',
        'MANI-RGL-502',
        502
      );
    }

    return this.tenantRulesRepository.saveNuevaVersion(ctx, { expectedVersion, reglas: respuesta.rules, correlationId });
  }
}

module.exports = TenantRulesUseCase;
