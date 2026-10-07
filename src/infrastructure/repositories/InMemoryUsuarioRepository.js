const IUsuarioRepository = require('../../domain/ports/IUsuarioRepository');

class InMemoryUsuarioRepository extends IUsuarioRepository {
  constructor() {
    super();
    this.usuarios = new Map(); // key: `${tenantId}::${email}`, también indexado por id
  }

  async findByEmail(tenantId, email) {
    return this.usuarios.get(`${tenantId}::${email.toLowerCase()}`) || null;
  }

  async create(usuario) {
    const record = { ...usuario, email: usuario.email.toLowerCase() };
    this.usuarios.set(`${record.tenantId}::${record.email}`, record);
    return record;
  }
}

module.exports = InMemoryUsuarioRepository;
