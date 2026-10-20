const IClientRepository = require('../../domain/ports/IClientRepository');

class InMemoryClientRepository extends IClientRepository {
  constructor() {
    super();
    this.clients = new Map([
      ['demo-client-1', { id: 'demo-client-1', tenantId: 'trama-demo', usuarioId: 'cliente-dueno-1' }],
    ]);
  }

  async findUsuarioIdByClientId(tenantId, clientId) {
    const client = this.clients.get(clientId);
    if (client && client.tenantId === tenantId) {
      return client.usuarioId;
    }
    return null;
  }

  setClient(id, data) {
    this.clients.set(id, data);
  }
}

module.exports = InMemoryClientRepository;
