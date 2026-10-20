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
      id: aliado.id || `aliado-${aliado.usuarioId}`,
      fechaRegistro: aliado.fechaRegistro || new Date().toISOString(),
      motivoRechazo: aliado.motivoRechazo ?? null,
      fechaVerificacion: aliado.fechaVerificacion ?? null,
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

  async findById(tenantId, aliadoId) {
    if (!tenantId || !aliadoId) return null;
    return (
      [...this.aliados.values()].find(
        (a) => a.tenantId === tenantId && (a.id === aliadoId || a.usuarioId === aliadoId)
      ) || null
    );
  }

  async findByTenant(tenantId, { estadoVerificacion } = {}) {
    if (!tenantId) return [];
    const items = [...this.aliados.values()].filter((a) => {
      if (a.tenantId !== tenantId) return false;
      if (estadoVerificacion) {
        return a.estadoVerificacion === estadoVerificacion;
      }
      return true;
    });
    return items.sort((a, b) => {
      const da = a.fechaRegistro ? new Date(a.fechaRegistro).getTime() : 0;
      const db = b.fechaRegistro ? new Date(b.fechaRegistro).getTime() : 0;
      return da - db;
    });
  }

  async updateVerificationStatus(
    tenantId,
    aliadoId,
    { estadoVerificacion, motivoRechazo = null, fechaVerificacion, verificadoPor = null }
  ) {
    const aliado = await this.findById(tenantId, aliadoId);
    if (!aliado) return null;
    if (aliado.estadoVerificacion !== 'PENDING' && aliado.estadoVerificacion !== 'PENDIENTE') {
      return null;
    }
    aliado.estadoVerificacion = estadoVerificacion;
    aliado.motivoRechazo = motivoRechazo;
    aliado.fechaVerificacion = fechaVerificacion || new Date().toISOString();
    aliado.verificadoPor = verificadoPor;
    return { ...aliado };
  }
}

module.exports = InMemoryAliadoRepository;

