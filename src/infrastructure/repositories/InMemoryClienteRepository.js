const crypto = require('node:crypto');
const IClienteRepository = require('../../domain/ports/IClienteRepository');

class InMemoryClienteRepository extends IClienteRepository {
  constructor() {
    super();
    this.clientes = new Map(); // key: usuarioId
  }

  // `cliente.id` es su propia PK (distinta de usuarioId), referenciada por
  // sitio.cliente_id -- igual que en el esquema real (01-schema.sql).
  async create(cliente) {
    const record = { id: crypto.randomUUID(), ...cliente };
    this.clientes.set(record.usuarioId, record);
    return record;
  }

  async deleteByUsuarioId(tenantId, usuarioId) {
    const cliente = this.clientes.get(usuarioId);
    if (cliente && cliente.tenantId === tenantId) {
      this.clientes.delete(usuarioId);
    }
  }
}

module.exports = InMemoryClienteRepository;
