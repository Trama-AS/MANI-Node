const IAliadoRepository = require('../../domain/ports/IAliadoRepository');

class InMemoryAliadoRepository extends IAliadoRepository {
  constructor() {
    super();
    this.aliados = new Map(); // key: usuarioId
    const demoAlly = {
      id: 'demo-aliado-1',
      usuarioId: 'demo-ally-1',
      tenantId: 'trama-demo',
      tipo: 'PERSONA_NATURAL',
      nombreRazonSocial: 'Aliado Demo MANI',
      estadoVerificacion: 'VERIFIED',
    };
    this.aliados.set(demoAlly.usuarioId, demoAlly);
  }

  async findByDocumentNumber(tenantId, documentNumber) {
    return (
      [...this.aliados.values()].find(
        (a) => a.tenantId === tenantId && a.documentNumber === documentNumber
      ) || null
    );
  }

  async findByUsuarioId(tenantId, usuarioId) {
    const aliado = this.aliados.get(usuarioId);
    if (!aliado) return null;
    if (tenantId && aliado.tenantId !== tenantId) return null;
    return aliado;
  }

  async create(aliado) {
    const record = {
      id: aliado.id || `ally-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      ...aliado,
    };
    this.aliados.set(aliado.usuarioId, record);
    return record;
  }

  async deleteByUsuarioId(tenantId, usuarioId) {
    const aliado = this.aliados.get(usuarioId);
    if (aliado && aliado.tenantId === tenantId) {
      this.aliados.delete(usuarioId);
    }
  }
}

module.exports = InMemoryAliadoRepository;
