/**
 * Interfaz / Puerto de Dominio para persistencia de la tabla `aliado`
 * (migrado de `registrar_aliado_persona_natural` + `handle_new_user`, ADR-0022).
 */
class IAliadoRepository {
  async findByDocumentNumber(_tenantId, _documentNumber) {
    throw new Error('Método findByDocumentNumber() no implementado en IAliadoRepository');
  }

  /**
   * Upsert por usuarioId (igual semántica que `handle_new_user`: ON CONFLICT (usuario_id) DO UPDATE).
   */
  async create(_aliado) {
    throw new Error('Método create() no implementado en IAliadoRepository');
  }
}

module.exports = IAliadoRepository;
