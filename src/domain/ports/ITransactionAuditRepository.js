/**
 * Puerto de consulta del registro inmutable de transacciones (SCRUM-889, HU-M11-03). El registro se escribe junto con
 * cada transacción (ver transaccionEvento.js); este puerto solo lo lee. Todo corre con el contexto verificado del JWT
 * (ADR-0032): un usuario ve solo los eventos de su tenant y, si es cliente, solo los de sus propios pagos.
 */
class ITransactionAuditRepository {
  /** Eventos de un pago. El cliente solo el suyo; el administrador, cualquiera de su tenant. */
  async listarPorPago(_ctx, _datos) {
    throw new Error('Método listarPorPago() no implementado en ITransactionAuditRepository');
  }

  /** Eventos del tenant, del más antiguo al más reciente, con cursor `despuesDe`. Solo el administrador. */
  async listar(_ctx, _datos) {
    throw new Error('Método listar() no implementado en ITransactionAuditRepository');
  }
}

module.exports = ITransactionAuditRepository;
