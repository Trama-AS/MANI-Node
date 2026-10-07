const IClienteRepository = require('../../domain/ports/IClienteRepository');

class InMemoryClienteRepository extends IClienteRepository {
  constructor() {
    super();
    this.clientes = new Map(); // key: usuarioId
  }

  async create(cliente) {
    this.clientes.set(cliente.usuarioId, cliente);
    return cliente;
  }

  async deleteByUsuarioId(tenantId, usuarioId) {
    const cliente = this.clientes.get(usuarioId);
    if (cliente && cliente.tenantId === tenantId) {
      this.clientes.delete(usuarioId);
    }
  }
}

module.exports = InMemoryClienteRepository;
