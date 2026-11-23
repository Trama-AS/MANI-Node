const IRuleEvaluationService = require('../../domain/ports/IRuleEvaluationService');
const RuleEvaluationResult = require('../../domain/entities/RuleEvaluationResult');
const { DomainError } = require('../../domain/errors/DomainError');
const {
  configurarCliente,
  ejecutarConReintentos,
  enviarConEspera,
  errorDeServidor,
  errorDeContrato,
} = require('./resilientHttp');
const { resolveCorrelationId } = require('../observability/logger');

const EVALUATE_PATH = '/api/v1/rules/categories/evaluate';
const RATES_PATH = '/api/v1/rules/rates/evaluate';
const TENANT_RULES_PATH = '/api/v1/rules/tenant-rules/validate';
const RESULTADOS_TARIFA = new Set(['DENTRO_DE_RANGO', 'POR_DEBAJO', 'POR_ENCIMA']);
// Lote máximo que acepta Rules por petición (RateEvaluationRequest); el reporte parte la lista.
const RATES_BATCH = 500;

function unavailable(detail) {
  return new DomainError(
    `El servicio de reglas no está disponible: ${detail}`,
    'RULES_SERVICE_UNAVAILABLE',
    503
  );
}

/**
 * Adaptador HTTP real de IRuleEvaluationService contra MANI-Java (US-03.1.1-M6, SCRUM-1658, SCRUM-1663).
 * Llama por la red interna (RULES_SERVICE_URL), no a través del Gateway, propagando el tenant,
 * el rol y el X-Correlation-ID de la petición en curso.
 *
 * Falla cerrado: si Rules no responde o el circuit breaker está abierto, la operación se rechaza con 503.
 */
class RulesServiceHttpClient extends IRuleEvaluationService {
  constructor(options = {}) {
    super();
    Object.assign(this, configurarCliente('mani-rules-java', options));
  }

  async evaluateCategoryRules({ tenantId, categoryId = null, context, role, correlationId } = {}) {
    const body = await this._post(EVALUATE_PATH, { tenantId, role, correlationId }, { categoryId, context });
    try {
      return new RuleEvaluationResult(body || {});
    } catch (err) {
      throw new DomainError(`Respuesta del servicio de reglas fuera de contrato: ${err.message}`, 'RULES_SERVICE_ERROR', 502);
    }
  }

  async evaluateRates({ tenantId, role, correlationId, items = [] } = {}) {
    const resultados = [];
    let version = null;
    for (let i = 0; i < items.length; i += RATES_BATCH) {
      const lote = items.slice(i, i + RATES_BATCH);
      const body = await this._post(RATES_PATH, { tenantId, role, correlationId }, { items: lote });
      const recibidos = Array.isArray(body && body.resultados) ? body.resultados : null;
      // Cada importe enviado debe volver evaluado: un resultado que falta o es desconocido no se adivina en Core.
      const esperados = new Set(lote.map((item) => item.id));
      const validos =
        recibidos &&
        recibidos.length === lote.length &&
        recibidos.every((r) => r && esperados.has(r.id) && RESULTADOS_TARIFA.has(r.resultado) && Number.isFinite(r.desviacionPorcentaje));
      if (!validos) {
        throw new DomainError('Respuesta del servicio de reglas fuera de contrato: resultados de tarifa incompletos', 'RULES_SERVICE_ERROR', 502);
      }
      version = body.version || version;
      resultados.push(...recibidos.map(({ id, resultado, desviacionPorcentaje }) => ({ id, resultado, desviacionPorcentaje })));
    }
    return { version, resultados };
  }

  async validateTenantRules({ tenantId, role, correlationId, rules } = {}) {
    const body = await this._post(TENANT_RULES_PATH, { tenantId, role, correlationId }, { rules });
    if (!body || body.valid !== true) {
      const msgs = body && Array.isArray(body.violations) ? body.violations.join(', ') : 'reglas incompatibles';
      throw new DomainError(`Reglas de tenant incompatibles: ${msgs}`, 'RULES_VALIDATION_ERROR', 422);
    }
    return body;
  }

  async _post(path, { tenantId, role, correlationId }, payload) {
    if (!this.baseUrl) {
      throw unavailable('RULES_SERVICE_URL no está configurada');
    }

    const cid = resolveCorrelationId({ correlationId });
    const request = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': tenantId,
        'X-User-Role': role,
        'X-Correlation-ID': cid,
      },
      body: JSON.stringify(payload),
    };

    return ejecutarConReintentos(this, () => this._send(path, request), unavailable);
  }

  async _send(path, request) {
    const response = await enviarConEspera(this, path, request);

    if (response.ok) {
      return response.json().catch(() => null);
    }

    if (response.status >= 500) throw errorDeServidor(response.status);

    // Un 4xx de Rules significa que Core violó el contrato (encabezados o cuerpo): es una falla
    // de integración, no un dato inválido del usuario.
    throw await errorDeContrato(response, 'reglas', 'RULES_SERVICE_ERROR');
  }
}

module.exports = RulesServiceHttpClient;
