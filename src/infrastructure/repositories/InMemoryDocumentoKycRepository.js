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

  async deleteByAliadoId(tenantId, aliadoId) {
    this.rows = this.rows.filter((r) => !(r.tenantId === tenantId && r.aliadoId === aliadoId));
  }
}

module.exports = InMemoryDocumentoKycRepository;
