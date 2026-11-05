/**
 * Puerto de los pagos del cliente (HU-M11-01, RF-24). Toda operación corre con el contexto verificado del JWT
 * (ADR-0032) y solo ve los pagos del cliente de la sesión: lo ajeno responde como inexistente.
 */
class IPaymentRepository {
  /**
   * Valida que la cotización sea del cliente de la sesión y esté aceptada, y que no tenga ya un pago aprobado.
   * Si la clave de idempotencia ya registró un pago, lo devuelve en lugar de preparar otro cobro.
   * @param {{ tenantId: string, userId: string, role: string }} _ctx
   * @param {{ cotizacionId: string, claveIdempotencia: string|null }} _datos
   * @returns {Promise<{ existente: object } | { cobro: { cotizacionId: string, solicitudId: string, clienteId: string,
   *           monto: number, moneda: string } }>}
   */
  async prepararCobro(_ctx, _datos) {
    throw new Error('Método prepararCobro() no implementado en IPaymentRepository');
  }

  /**
   * Registra el desenlace que decidió el proveedor. Un reintento con la misma clave devuelve el pago ya registrado.
   * @returns {Promise<{ pago: object, creado: boolean }>}
   */
  async registrar(_ctx, _datos) {
    throw new Error('Método registrar() no implementado en IPaymentRepository');
  }

  /** @returns {Promise<object>} el pago del cliente de la sesión; lanza 404 si no existe o es de otro cliente */
  async obtener(_ctx, _pagoId) {
    throw new Error('Método obtener() no implementado en IPaymentRepository');
  }
}

module.exports = IPaymentRepository;
