const IDispatchAssignmentService = require('../../domain/ports/IDispatchAssignmentService');
const { DomainError } = require('../../domain/errors/DomainError');

const ASSIGNMENTS_PATH = '/api/v1/dispatch/assignments/me';
const RETRYABLE_STATUS = new Set([502, 503, 504]);

function unavailable(detail) {
  return new DomainError(`El servicio de despacho no está disponible: ${detail}`, 'DISPATCH_SERVICE_UNAVAILABLE', 503);
}

/**
 * Adaptador HTTP de IDispatchAssignmentService contra MANI-Dispatch (SCRUM-853).
 * Llama por la red interna (DISPATCH_SERVICE_URL), no a través del Gateway, reenviando el JWT del aliado:
 * Dispatch lo resuelve con Core y devuelve solo sus asignaciones.
 *
 * Falla cerrado (criterio T2): si Dispatch no responde, la consulta se rechaza con 503 en vez de suponer que el
 * aliado está o no asignado. La consulta es de solo lectura, así que se reintenta una vez ante errores de red o
 * 502/503/504.
 */
class DispatchServiceHttpClient extends IDispatchAssignmentService {
  constructor({ baseUrl, timeoutMs = 3000, retries = 1, fetchImpl = globalThis.fetch } = {}) {
    super();
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
    this.retries = retries;
    this.fetchImpl = fetchImpl;
  }

  async listMyAssignedRequestIds({ authorization, correlationId } = {}) {
    if (!this.baseUrl) {
      throw unavailable('DISPATCH_SERVICE_URL no está configurada');
    }

    const request = {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: authorization || '',
        'X-Correlation-ID': correlationId || 'none',
      },
    };

    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      try {
        return await this._send(request);
      } catch (err) {
        if (err instanceof DomainError) throw err;
        lastError = err;
        if (!err.retryable) break;
      }
    }
    throw unavailable(lastError.message);
  }

  async _send(request) {
    let response;
    try {
      response = await this.fetchImpl(`${this.baseUrl.replace(/\/$/, '')}${ASSIGNMENTS_PATH}`, {
        ...request,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const reason = err.name === 'TimeoutError' ? `sin respuesta en ${this.timeoutMs} ms` : err.message;
      throw Object.assign(new Error(reason), { retryable: true });
    }

    if (response.ok) {
      const body = await response.json().catch(() => null);
      if (!body || !Array.isArray(body.requestIds)) {
        throw new DomainError('Respuesta del servicio de despacho fuera de contrato: falta requestIds', 'DISPATCH_SERVICE_ERROR', 502);
      }
      return body.requestIds.map(String);
    }

    // 403: Dispatch no reconoce a la cuenta como aliado del tenant, así que no tiene asignaciones.
    if (response.status === 403) return [];

    if (response.status >= 500) {
      throw Object.assign(new Error(`respondió ${response.status}`), { retryable: RETRYABLE_STATUS.has(response.status) });
    }

    // Otro 4xx (p. ej. 401 con un token que Core ya validó) es una falla de integración entre servicios.
    const body = await response.json().catch(() => ({}));
    throw new DomainError(
      `El servicio de despacho rechazó la petición (${response.status} ${body.code || ''}): ${body.error || ''}`.trim(),
      'DISPATCH_SERVICE_ERROR',
      502
    );
  }
}

module.exports = DispatchServiceHttpClient;
