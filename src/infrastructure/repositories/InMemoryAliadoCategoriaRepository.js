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
}

module.exports = InMemoryAliadoCategoriaRepository;
