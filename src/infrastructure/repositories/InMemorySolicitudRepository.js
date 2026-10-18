const crypto = require('crypto');
const ISolicitudRepository = require('../../domain/ports/ISolicitudRepository');
const Solicitud = require('../../domain/entities/Solicitud');

class InMemorySolicitudRepository extends ISolicitudRepository {
  constructor() {
    super();
    this.solicitudes = new Map();

    const demoSolicitud = new Solicitud({
      id: 'sol-demo-1',
      tenantId: 'trama-demo',
      clienteId: 'demo-client-1',
      aliadoId: 'demo-ally-1',
      categoriaId: 'cat-plomeria',
      zonaId: 'zona-norte',
      descripcion: 'Reparación de fuga en baño principal',
      direccion: 'Calle 100 # 15-20',
      estado: 'ASIGNADA',
      fechaCreacion: new Date(Date.now() - 3600000).toISOString(),
    });
    this.solicitudes.set(demoSolicitud.id, demoSolicitud);
  }

  async create(solicitud) {
    const id = solicitud.id || crypto.randomUUID();
    const entity = new Solicitud({
      ...solicitud,
      id,
    });
    this.solicitudes.set(id, entity);
    return entity;
  }

  async findById(id) {
    const found = this.solicitudes.get(id);
    return found ? new Solicitud(found) : null;
  }

  async findByClienteId(clienteId, { tenantId, estado } = {}) {
    return [...this.solicitudes.values()]
      .filter((s) => {
        if (s.clienteId !== clienteId) return false;
        if (tenantId && s.tenantId !== tenantId) return false;
        if (estado && s.estado !== estado) return false;
        return true;
      })
      .sort((a, b) => new Date(b.fechaCreacion) - new Date(a.fechaCreacion))
      .map((s) => new Solicitud(s));
  }

  async findByAliadoId(aliadoId, { tenantId, estado } = {}) {
    return [...this.solicitudes.values()]
      .filter((s) => {
        if (s.aliadoId !== aliadoId) return false;
        if (tenantId && s.tenantId !== tenantId) return false;
        if (estado && s.estado !== estado) return false;
        return true;
      })
      .sort((a, b) => new Date(b.fechaCreacion) - new Date(a.fechaCreacion))
      .map((s) => new Solicitud(s));
  }

  async update(solicitud) {
    const existing = this.solicitudes.get(solicitud.id);
    if (!existing) return null;
    const updated = new Solicitud({
      ...existing,
      ...solicitud,
    });
    this.solicitudes.set(solicitud.id, updated);
    return updated;
  }
}

module.exports = InMemorySolicitudRepository;
