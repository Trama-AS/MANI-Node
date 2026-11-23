const IPaymentProvider = require('../../domain/ports/IPaymentProvider');
const PaymentProviderError = require('../../domain/errors/PaymentProviderError');

const DESENLACES = ['APROBADO', 'RECHAZADO', 'PENDIENTE'];

/**
 * Segundo adaptador de pagos (SCRUM-1725, QAS-26): cobra contra un sandbox de pagos por HTTP, en lugar de simular en
 * memoria como el mock. Sirve para comprobar que el puerto IPaymentProvider se puede intercambiar por configuración
 * (`PAYMENT_PROVIDER=sandbox_http`) y es la forma que tendrá el operador certificado (ADR-0023/0024).
 *
 * Contrato común (SCRUM-1240): la idempotencia la resuelve el sandbox con la cabecera `Idempotency-Key`; el adaptador
 * respeta `signal`; sin desenlace lanza PaymentProviderError y nunca devuelve un éxito falso. Sigue siendo
 * `simulated: true`: el sandbox no mueve dinero real. La credencial (`apiKey`) solo viaja en `Authorization`: no se
 * registra ni aparece en ningún mensaje de error.
 */
class HttpSandboxPaymentProvider extends IPaymentProvider {
  constructor({ url, apiKey, fetchImpl = globalThis.fetch } = {}) {
    super();
    if (!url) throw new Error('HttpSandboxPaymentProvider requiere url');
    if (typeof fetchImpl !== 'function') throw new Error('HttpSandboxPaymentProvider requiere fetch');
    this.baseUrl = String(url).replace(/\/+$/, '');
    this.apiKey = apiKey || null;
    this.fetchImpl = fetchImpl;
  }

  get name() {
    return 'sandbox_http';
  }

  get simulated() {
    return true;
  }

  async charge({ monto, moneda, referencia, idempotencyKey, correlationId, signal } = {}) {
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    if (correlationId) headers['X-Correlation-ID'] = correlationId;
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;

    let respuesta;
    try {
      respuesta = await this.fetchImpl(`${this.baseUrl}/cobros`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ monto, moneda, referencia }),
        signal,
      });
    } catch (err) {
      // Core aborta por timeout: el adaptador deja de esperar. El detalle de la red no se propaga (puede traer direcciones).
      if (signal?.aborted || err?.name === 'AbortError' || err?.name === 'TimeoutError') {
        throw new PaymentProviderError('TIMEOUT', 'El sandbox de pagos no respondió a tiempo');
      }
      throw new PaymentProviderError('UNAVAILABLE', 'El sandbox de pagos no está disponible');
    }

    if (respuesta.status === 408 || respuesta.status === 504) {
      throw new PaymentProviderError('TIMEOUT', 'El sandbox de pagos no respondió a tiempo');
    }
    if (respuesta.status === 429 || respuesta.status >= 500) {
      throw new PaymentProviderError('UNAVAILABLE', 'El sandbox de pagos no está disponible');
    }
    if (!respuesta.ok) {
      throw new PaymentProviderError('INVALID_RESPONSE', `El sandbox de pagos respondió ${respuesta.status}`);
    }

    let cuerpo;
    try {
      cuerpo = await respuesta.json();
    } catch {
      throw new PaymentProviderError('INVALID_RESPONSE', 'El sandbox de pagos respondió algo que no es JSON');
    }
    const referenciaProveedor = typeof cuerpo?.referencia === 'string' ? cuerpo.referencia.trim() : '';
    if (!DESENLACES.includes(cuerpo?.estado) || !referenciaProveedor) {
      throw new PaymentProviderError('INVALID_RESPONSE', 'El sandbox de pagos respondió un desenlace fuera del contrato');
    }
    const desenlace = { estado: cuerpo.estado, referencia: referenciaProveedor };
    if (cuerpo.estado === 'RECHAZADO' && typeof cuerpo.motivo === 'string' && cuerpo.motivo.trim()) {
      desenlace.motivo = cuerpo.motivo.trim();
    }
    return desenlace;
  }
}

module.exports = HttpSandboxPaymentProvider;
