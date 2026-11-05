/**
 * Puerto de las quejas (M-12: SCRUM-895, SCRUM-896; RF-26). Todo método recibe el contexto verificado del JWT
 * `{ tenantId, userId, role }` (T4). El cliente solo alcanza sus quejas; el administrador, las de su tenant.
 */
class IComplaintRepository {
  /** Crea la queja ABIERTA sobre una solicitud propia y registra la transición inicial. */
  async registrar(_ctx, _datos) {
    throw new Error('Método registrar() no implementado en IComplaintRepository');
  }

  /** Quejas visibles a la sesión, de la más reciente a la más antigua. */
  async listar(_ctx, _filtro) {
    throw new Error('Método listar() no implementado en IComplaintRepository');
  }

  /** Una queja visible a la sesión con su historial de transiciones. */
  async detalle(_ctx, _datos) {
    throw new Error('Método detalle() no implementado en IComplaintRepository');
  }

  /** Aplica una transición válida y la audita; una inválida no modifica nada (409). */
  async cambiarEstado(_ctx, _datos) {
    throw new Error('Método cambiarEstado() no implementado en IComplaintRepository');
  }
}

module.exports = IComplaintRepository;
