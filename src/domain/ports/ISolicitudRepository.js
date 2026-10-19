/**
 * Puerto de lectura y transición de estado de solicitudes desde Core (RF-12, RF-18, RF-19).
 * Todas las operaciones reciben el contexto verificado `ctx = { tenantId, userId, role }`.
 * Core no asigna el aliado: eso lo hace Dispatch con exclusión concurrente (ADR-0016).
 */
class ISolicitudRepository {
  async findById(_ctx, _id) {
    throw new Error('Método findById no implementado');
  }

  async findByClienteId(_ctx, _clienteId, _options = {}) {
    throw new Error('Método findByClienteId no implementado');
  }

  async updateEstado(_ctx, _id, _estado) {
    throw new Error('Método updateEstado no implementado');
  }
}

module.exports = ISolicitudRepository;
