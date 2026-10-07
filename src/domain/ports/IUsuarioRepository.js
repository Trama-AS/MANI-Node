/**
 * Interfaz / Puerto de Dominio para persistencia de la tabla `usuario`
 * (migrado de la lógica que vivía en el trigger `handle_new_user`, ADR-0022).
 */
class IUsuarioRepository {
  async findByEmail(_tenantId, _email) {
    throw new Error('Método findByEmail() no implementado en IUsuarioRepository');
  }

  /**
   * Upsert por id (igual semántica que `handle_new_user`: ON CONFLICT (id) DO UPDATE).
   */
  async create(_usuario) {
    throw new Error('Método create() no implementado en IUsuarioRepository');
  }
}

module.exports = IUsuarioRepository;
