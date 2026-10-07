const IAliadoRepository = require('../../domain/ports/IAliadoRepository');

class InMemoryAliadoRepository extends IAliadoRepository {
  constructor() {
    super();
    this.aliados = new Map(); // key: usuarioId
  }

  async findByDocumentNumber(tenantId, documentNumber) {
    return (
      [...this.aliados.values()].find(
        (a) => a.tenantId === tenantId && a.documentNumber === documentNumber
      ) || null
    );
  }

  async create(aliado) {
    this.aliados.set(aliado.usuarioId, aliado);
    return aliado;
  }
}

module.exports = InMemoryAliadoRepository;
