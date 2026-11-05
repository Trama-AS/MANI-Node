const { ConflictError } = require('../../../domain/errors/DomainError');
const { contextoDeSesion, uuidValido } = require('./paymentAccess');

const LEYENDA_SIMULADO = 'COMPROBANTE DE PRUEBA · SANDBOX · SIN VALOR CONTABLE NI FISCAL · NO SE MOVIÓ DINERO REAL';

/** Consulta del pago y de su comprobante de sandbox (HU-M11-01, C1 y C3): solo el cliente que pagó. */
class GetPaymentUseCase {
  constructor({ paymentRepository }) {
    if (!paymentRepository) throw new Error('paymentRepository es requerido para GetPaymentUseCase');
    this.paymentRepository = paymentRepository;
  }

  async obtener({ user, pagoId }) {
    const ctx = contextoDeSesion(user);
    return this.paymentRepository.obtener(ctx, uuidValido(pagoId, 'el id del pago'));
  }

  /** Solo un pago aprobado tiene comprobante. Siempre se identifica como simulado si el proveedor lo es. */
  async comprobante({ user, pagoId }) {
    const pago = await this.obtener({ user, pagoId });
    if (pago.estado !== 'APROBADO') {
      throw new ConflictError(
        `MANI-PAG-409C: un pago ${pago.estado.toLowerCase()} no tiene comprobante; solo los aprobados`,
        'MANI-PAG-409C'
      );
    }
    return {
      numero: `${pago.simulado ? 'SIM' : 'PAG'}-${pago.id.slice(0, 8).toUpperCase()}`,
      simulado: pago.simulado,
      leyenda: pago.simulado ? LEYENDA_SIMULADO : null,
      pagoId: pago.id,
      cotizacionId: pago.cotizacionId,
      monto: pago.monto,
      moneda: pago.moneda,
      estado: pago.estado,
      proveedor: pago.proveedor,
      referenciaProveedor: pago.referenciaProveedor,
      fecha: pago.creadoEn instanceof Date ? pago.creadoEn.toISOString() : pago.creadoEn,
    };
  }
}

GetPaymentUseCase.LEYENDA_SIMULADO = LEYENDA_SIMULADO;
module.exports = GetPaymentUseCase;
