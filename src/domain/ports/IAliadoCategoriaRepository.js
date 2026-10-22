/**
 * Interfaz / Puerto de Dominio para persistencia de `aliado_categoria`
 * (categorías de servicio que atiende un Aliado).
 */
class IAliadoCategoriaRepository {
  async create(_aliadoCategoria) {
    throw new Error('Método create() no implementado en IAliadoCategoriaRepository');
  }

  async findByAliadoId(_tenantId, _aliadoId) {
    throw new Error('Método findByAliadoId() no implementado en IAliadoCategoriaRepository');
  }

  async setAliadoCategorias(_tenantId, _aliadoId, _categoriaIds) {
    throw new Error('Método setAliadoCategorias() no implementado en IAliadoCategoriaRepository');
  }

  /** Compensación (B3): deshace create() si un paso posterior del registro falla. */
  async deleteByAliadoId(_tenantId, _aliadoId) {
    throw new Error('Método deleteByAliadoId() no implementado en IAliadoCategoriaRepository');
  }
}

module.exports = IAliadoCategoriaRepository;
