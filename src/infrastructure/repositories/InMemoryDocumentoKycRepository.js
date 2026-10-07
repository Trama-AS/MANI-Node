const IDocumentoKycRepository = require('../../domain/ports/IDocumentoKycRepository');

class InMemoryDocumentoKycRepository extends IDocumentoKycRepository {
  constructor() {
    super();
    this.rows = [];
  }

  async createMany(tenantId, aliadoId, documentos) {
    const created = documentos.map((d) => ({ tenantId, aliadoId, estado: 'PENDING', ...d }));
    this.rows.push(...created);
    return created;
  }
}

module.exports = InMemoryDocumentoKycRepository;
