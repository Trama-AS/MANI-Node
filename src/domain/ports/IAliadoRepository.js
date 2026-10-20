/**
 * Interfaz / Puerto de Dominio para persistencia de la tabla `aliado`
 * (migrado de `registrar_aliado_persona_natural` + `handle_new_user`, ADR-0022).
 */
class IAliadoRepository {
  async findByDocumentNumber(_tenantId, _documentNumber) {
    throw new Error('Método findByDocumentNumber() no implementado en IAliadoRepository');
  }

  async findByUsuarioId(_tenantId, _usuarioId) {
    throw new Error('Método findByUsuarioId() no implementado en IAliadoRepository');
  }

  /**
   * Upsert por usuarioId (igual semántica que `handle_new_user`: ON CONFLICT (usuario_id) DO UPDATE).
   */
  async create(_aliado) {
    throw new Error('Método create() no implementado en IAliadoRepository');
  }

  /** Compensación (B3): deshace create() si un paso posterior del registro falla. */
  async deleteByUsuarioId(_tenantId, _usuarioId) {
    throw new Error('Método deleteByUsuarioId() no implementado en IAliadoRepository');
  }

  async findById(_tenantId, _aliadoId) {
    throw new Error('Método findById() no implementado en IAliadoRepository');
  }

  async findByTenant(_tenantId, _filters) {
    throw new Error('Método findByTenant() no implementado en IAliadoRepository');
  }

  async updateVerificationStatus(_tenantId, _aliadoId, _decisionData) {
    throw new Error('Método updateVerificationStatus() no implementado en IAliadoRepository');
  }
}

module.exports = IAliadoRepository;

