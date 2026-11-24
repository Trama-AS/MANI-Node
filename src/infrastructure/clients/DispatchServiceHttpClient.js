const IDispatchAssignmentService = require('../../domain/ports/IDispatchAssignmentService');
const { DomainError } = require('../../domain/errors/DomainError');
const {
  configurarCliente,
  ejecutarConReintentos,
  enviarConEspera,
  errorDeServidor,
  errorDeContrato,
} = require('./resilientHttp');
const { resolveCorrelationId } = require('../observability/logger');

const ASSIGNMENTS_PATH = '/api/v1/dispatch/assignments/me';

function unavailable(detail) {
  return new DomainError(`El servicio de despacho no está disponible: ${detail}`, 'DISPATCH_SERVICE_UNAVAILABLE', 503);
}

/**
 * Adaptador HTTP de IDispatchAssignmentService contra MANI-Dispatch (SCRUM-853, SCRUM-1658, SCRUM-1663).
 * Llama por la red interna (DISPATCH_SERVICE_URL), no a través del Gateway, reenviando el JWT del aliado
 * y el X-Correlation-ID de la petición en curso.
 *
 * Falla cerrado (criterio T2): si Dispatch no responde o el circuit breaker está abierto, la consulta se rechaza con 503.
 */
class DispatchServiceHttpClient extends IDispatchAssignmentService {
  constructor(options = {}) {
    super();
    Object.assign(this, configurarCliente('mani-dispatch-dotnet', options));
  }

  async listMyAssignedRequestIds({ authorization, correlationId } = {}) {
    if (!this.baseUrl) {
      throw unavailable('DISPATCH_SERVICE_URL no está configurada');
    }

    const cid = resolveCorrelationId({ correlationId });
    const request = {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: authorization || '',
        'X-Correlation-ID': cid,
      },
    };

    return ejecutarConReintentos(this, () => this._send(request), unavailable);
  }

  async _send(request) {
    const response = await enviarConEspera(this, ASSIGNMENTS_PATH, request);

    if (response.ok) {
      const body = await response.json().catch(() => null);
      if (!body || !Array.isArray(body.requestIds)) {
        throw new DomainError('Respuesta del servicio de despacho fuera de contrato: falta requestIds', 'DISPATCH_SERVICE_ERROR', 502);
      }
      return body.requestIds.map(String);
    }

    // 403: Dispatch no reconoce a la cuenta como aliado del tenant, así que no tiene asignaciones.
    if (response.status === 403) return [];

    if (response.status >= 500) throw errorDeServidor(response.status);

    // Otro 4xx (p. ej. 401 con un token que Core ya validó) es una falla de integración entre servicios.
    throw await errorDeContrato(response, 'despacho', 'DISPATCH_SERVICE_ERROR');
  }
}

module.exports = DispatchServiceHttpClient;
