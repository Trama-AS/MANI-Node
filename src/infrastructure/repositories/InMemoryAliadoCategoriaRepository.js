const IAliadoCategoriaRepository = require('../../domain/ports/IAliadoCategoriaRepository');

class InMemoryAliadoCategoriaRepository extends IAliadoCategoriaRepository {
  constructor() {
    super();
    this.rows = [];
  }

  async create(aliadoCategoria) {
    this.rows.push(aliadoCategoria);
    return aliadoCategoria;
  }

  async deleteByAliadoId(tenantId, aliadoId) {
    this.rows = this.rows.filter((r) => !(r.tenantId === tenantId && r.aliadoId === aliadoId));
  }
}

module.exports = InMemoryAliadoCategoriaRepository;
