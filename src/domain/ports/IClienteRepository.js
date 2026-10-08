/**
 * Interfaz / Puerto de Dominio para persistencia de la tabla `cliente`
 * (migrado de `registrar_cliente_persona_natural` + la rama CLIENTE de
 * `handle_new_user`, US-02.2.1-M2). Deliberadamente más simple que
 * `IAliadoRepository`: `cliente` no tiene KYC, categoría ni verificación.
 */
class IClienteRepository {
  /**
   * Upsert por usuarioId (igual semántica que `handle_new_user`: ON CONFLICT (usuario_id) DO UPDATE).
   */
  async create(_cliente) {
    throw new Error('Método create() no implementado en IClienteRepository');
  }

  /** Compensación (B3): deshace create() si un paso posterior del registro falla. */
  async deleteByUsuarioId(_tenantId, _usuarioId) {
    throw new Error('Método deleteByUsuarioId() no implementado en IClienteRepository');
  }
}

module.exports = IClienteRepository;
