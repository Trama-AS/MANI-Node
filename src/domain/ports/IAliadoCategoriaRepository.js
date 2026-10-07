/**
 * Interfaz / Puerto de Dominio para persistencia de `aliado_categoria`
 * (categorías de servicio que atiende un Aliado).
 */
class IAliadoCategoriaRepository {
  async create(_aliadoCategoria) {
    throw new Error('Método create() no implementado en IAliadoCategoriaRepository');
  }
}

module.exports = IAliadoCategoriaRepository;
