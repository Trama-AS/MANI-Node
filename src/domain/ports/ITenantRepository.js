/**
 * Interfaz / Puerto de Dominio para persistencia de Tenants.
 */
class ITenantRepository {
  async findAll() {
    throw new Error('Método findAll() no implementado en ITenantRepository');
  }

  async findById(_id) {
    throw new Error('Método findById() no implementado en ITenantRepository');
  }

  async findBySlug(_slug) {
    throw new Error('Método findBySlug() no implementado en ITenantRepository');
  }
}

module.exports = ITenantRepository;

