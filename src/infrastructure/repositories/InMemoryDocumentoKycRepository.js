const IDocumentoKycRepository = require('../../domain/ports/IDocumentoKycRepository');

class InMemoryDocumentoKycRepository extends IDocumentoKycRepository {
  constructor() {
    super();
    this.rows = [];
  }

  async createMany(tenantId, aliadoId, documentos) {
    const created = documentos.map((d, idx) => ({
      id: d.id || `doc-${aliadoId}-${idx + 1}`,
      tenantId,
      aliadoId,
      estado: 'PENDING',
      fechaCarga: d.fechaCarga || new Date().toISOString(),
      ...d,
    }));
    this.rows.push(...created);
    return created;
  }

  async deleteByAliadoId(tenantId, aliadoId) {
    this.rows = this.rows.filter((r) => !(r.tenantId === tenantId && r.aliadoId === aliadoId));
  }

  async findByAliadoId(tenantId, aliadoId) {
    if (!tenantId || !aliadoId) return [];
    return this.rows.filter((r) => r.tenantId === tenantId && r.aliadoId === aliadoId);
  }

  async updateStatusByAliadoId(tenantId, aliadoId, estado) {
    const updated = [];
    for (const r of this.rows) {
      if (r.tenantId === tenantId && r.aliadoId === aliadoId) {
        r.estado = estado;
        updated.push(r);
      }
    }
    return updated;
  }
}

module.exports = InMemoryDocumentoKycRepository;

