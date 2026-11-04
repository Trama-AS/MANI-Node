const IRuleEvaluationService = require('../../domain/ports/IRuleEvaluationService');
const RuleEvaluationResult = require('../../domain/entities/RuleEvaluationResult');
const { DomainError } = require('../../domain/errors/DomainError');

const EVALUATE_PATH = '/api/v1/rules/categories/evaluate';
const RATES_PATH = '/api/v1/rules/rates/evaluate';
const RESULTADOS_TARIFA = new Set(['DENTRO_DE_RANGO', 'POR_DEBAJO', 'POR_ENCIMA']);
// Lote máximo que acepta Rules por petición (RateEvaluationRequest); el reporte parte la lista.
const RATES_BATCH = 500;
const RETRYABLE_STATUS = new Set([502, 503, 504]);

function unavailable(detail) {
  return new DomainError(
    `El servicio de reglas no está disponible: ${detail}`,
    'RULES_SERVICE_UNAVAILABLE',
    503
  );
}

/**
 * Adaptador HTTP real de IRuleEvaluationService contra MANI-Java (US-03.1.1-M6).
 * Llama por la red interna (RULES_SERVICE_URL), no a través del Gateway, propagando el tenant y
 * el rol ya verificados en el JWT como X-Tenant-Id / X-User-Role, igual que hace el Gateway.
 *
 * Falla cerrado: si Rules no responde, la operación se rechaza con 503 en vez de aplicar las
 * reglas antiguas en Core. La evaluación es idempotente, así que se reintenta una vez ante
 * errores de red o 502/503/504.
 */
class RulesServiceHttpClient extends IRuleEvaluationService {
  constructor({ baseUrl, timeoutMs = 3000, retries = 1, fetchImpl = globalThis.fetch } = {}) {
    super();
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.fetchImpl = fetchImpl;
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

  async _post(path, { tenantId, role, correlationId }, payload) {
    if (!this.baseUrl) {
      throw unavailable('RULES_SERVICE_URL no está configurada');
    }

    const request = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant-Id': tenantId,
        'X-User-Role': role,
        'X-Correlation-ID': correlationId || 'none',
      },
      body: JSON.stringify(payload),
    };

    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        return await this._send(path, request);
      } catch (err) {
        if (err instanceof DomainError) throw err;
        lastError = err;
        if (!err.retryable) break;
      }
    }
    throw unavailable(lastError.message);
  }

  async _send(path, request) {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
        ...request,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const reason = err.name === 'TimeoutError' ? `sin respuesta en ${this.timeoutMs} ms` : err.message;
      throw Object.assign(new Error(reason), { retryable: true });
    }

    if (response.ok) {
      return response.json().catch(() => null);
    }

    if (RETRYABLE_STATUS.has(response.status) || response.status >= 500) {
      throw Object.assign(new Error(`respondió ${response.status}`), { retryable: RETRYABLE_STATUS.has(response.status) });
    }

    // Un 4xx de Rules significa que Core violó el contrato (encabezados o cuerpo): es una falla
    // de integración, no un dato inválido del usuario.
    const body = await response.json().catch(() => ({}));
    throw new DomainError(
      `El servicio de reglas rechazó la petición (${response.status} ${body.code || ''}): ${body.error || ''}`.trim(),
      'RULES_SERVICE_ERROR',
      502
    );
  }
}

module.exports = RulesServiceHttpClient;
