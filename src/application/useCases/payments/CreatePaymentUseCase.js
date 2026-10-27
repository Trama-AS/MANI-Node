const { DomainError, ValidationError } = require('../../../domain/errors/DomainError');
const PaymentProviderError = require('../../../domain/errors/PaymentProviderError');
const { contextoDeSesion, uuidValido } = require('./paymentAccess');

const DESENLACES = new Set(['APROBADO', 'RECHAZADO', 'PENDIENTE']);
// Campos que NUNCA debe traer el cuerpo: el sandbox no recibe datos de tarjeta (RNF-06, REST-03).
const CAMPOS_DE_TARJETA = /tarjeta|card|cvv|cvc|pan|expir|numero.?cuenta/i;

function invalido(mensaje) {
  return new ValidationError(`MANI-PAG-400: ${mensaje}`, 'MANI-PAG-400');
}

/** Un desenlace válido es uno de los tres permitidos y trae la referencia del proveedor (C2: sin éxito inventado). */
function desenlaceValido(resultado) {
  return Boolean(
    resultado &&
      DESENLACES.has(resultado.estado) &&
      typeof resultado.referencia === 'string' &&
      resultado.referencia.trim() !== ''
  );
}

/**
 * Pago del cliente en el sandbox (SCRUM-1432, HU-M11-01, RF-24). El cliente dueño de una cotización aceptada la paga
 * con el proveedor simulado. El monto sale de la cotización, nunca del cuerpo; el cliente, el tenant y el rol, del JWT.
 *
 * Si el proveedor no da un desenlace (timeout, respuesta inválida, caído) no se registra ningún pago: no hay éxito
 * falso ni efecto financiero, y la respuesta lleva el `correlationId` del manejador de errores (C2).
 */
class CreatePaymentUseCase {
  constructor({ paymentRepository, paymentProvider, auditLogger = (entry) => console.info(JSON.stringify(entry)) }) {
    if (!paymentRepository) throw new Error('paymentRepository es requerido para CreatePaymentUseCase');
    if (!paymentProvider) throw new Error('paymentProvider es requerido para CreatePaymentUseCase');
    this.paymentRepository = paymentRepository;
    this.paymentProvider = paymentProvider;
    this.auditLogger = auditLogger;
  }

  async execute({ user, body = {}, correlationId }) {
    const ctx = contextoDeSesion(user);

    const prohibido = Object.keys(body).find((campo) => CAMPOS_DE_TARJETA.test(campo));
    if (prohibido) {
      throw invalido(`no envíes datos de pago ("${prohibido}"): este es un sandbox y no recibe datos de tarjeta`);
    }
    const cotizacionId = uuidValido(body.cotizacionId, 'cotizacionId');
    const claveIdempotencia = body.claveIdempotencia ? uuidValido(body.claveIdempotencia, 'claveIdempotencia') : null;
    const escenario = body.escenario === undefined ? 'APROBADO' : String(body.escenario);

    const preparado = await this.paymentRepository.prepararCobro(ctx, { cotizacionId, claveIdempotencia });
    if (preparado.existente) return { pago: preparado.existente, creado: false };
    const { cobro } = preparado;

    let resultado;
    try {
      resultado = await this.paymentProvider.charge({
        monto: cobro.monto,
        moneda: cobro.moneda,
        referencia: cobro.cotizacionId,
        escenario,
        correlationId,
      });
      if (!desenlaceValido(resultado)) {
        throw new PaymentProviderError('INVALID_RESPONSE', 'El proveedor devolvió un desenlace fuera del contrato');
      }
    } catch (err) {
      this.#auditarFallo(ctx, cotizacionId, err, correlationId);
      throw this.#errorDeProveedor(err);
    }

    const registrado = await this.paymentRepository.registrar(ctx, {
      cotizacionId,
      clienteId: cobro.clienteId,
      monto: cobro.monto,
      moneda: cobro.moneda,
      estado: resultado.estado,
      proveedor: this.paymentProvider.name,
      simulado: this.paymentProvider.simulated,
      referenciaProveedor: resultado.referencia,
      motivo: resultado.motivo,
      correlationId,
      claveIdempotencia,
    });

    this.auditLogger({
      event: 'US-07.pago.registrado',
      tenant_id: ctx.tenantId,
      usuario_id: ctx.userId,
      pago_id: registrado.pago.id,
      estado: registrado.pago.estado,
      simulado: registrado.pago.simulado,
      correlation_id: correlationId,
    });
    return registrado;
  }

  #auditarFallo(ctx, cotizacionId, err, correlationId) {
    this.auditLogger({
      event: 'US-07.pago.proveedor_sin_desenlace',
      tenant_id: ctx.tenantId,
      usuario_id: ctx.userId,
      cotizacion_id: cotizacionId,
      causa: err instanceof PaymentProviderError ? err.kind : 'UNAVAILABLE',
      correlation_id: correlationId,
    });
  }

  #errorDeProveedor(err) {
    if (err instanceof PaymentProviderError && err.kind === 'TIMEOUT') {
      return new DomainError(
        'MANI-PAG-504: el proveedor de pagos no respondió a tiempo. No se realizó ningún cobro; inténtalo de nuevo.',
        'MANI-PAG-504',
        504
      );
    }
    return new DomainError(
      'MANI-PAG-502: el proveedor de pagos no dio una respuesta válida. No se realizó ningún cobro; inténtalo de nuevo.',
      'MANI-PAG-502',
      502
    );
  }
}

CreatePaymentUseCase.CAMPOS_DE_TARJETA = CAMPOS_DE_TARJETA;
module.exports = CreatePaymentUseCase;
