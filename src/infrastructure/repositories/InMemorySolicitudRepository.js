const ISolicitudRepository = require('../../domain/ports/ISolicitudRepository');
const Solicitud = require('../../domain/entities/Solicitud');

/** Adaptador en memoria (DEV/test sin DATABASE_URL). Mismo aislamiento por tenant que el real. */
class InMemorySolicitudRepository extends ISolicitudRepository {
  constructor() {
    super();
    this.solicitudes = new Map();

    // Solicitud de demostración asignada al aliado de demostración (`aliado.id` = demo-aliado-1).
    const demo = new Solicitud({
      id: 'sol-demo-1',
      tenantId: 'trama-demo',
      clienteId: 'demo-cliente-1',
      categoriaId: 'cat-plomeria',
      zonaId: 'zona-norte',
      aliadoId: 'demo-aliado-1',
      descripcion: 'Reparación de fuga en baño principal',
      estado: 'ASIGNADA',
      fechaCreacion: new Date(Date.now() - 3600000).toISOString(),
    });
    this.solicitudes.set(demo.id, demo);
  }

  /** Solo para pruebas y semillas de DEV. */
  seed(solicitud) {
    const entity = new Solicitud(solicitud);
    this.solicitudes.set(entity.id, entity);
    return entity;
  }

  async findById(ctx, id) {
    const found = this.solicitudes.get(id);
    return found && found.tenantId === ctx.tenantId ? new Solicitud(found) : null;
  }

  async findByClienteId(ctx, clienteId, { estado } = {}) {
    return [...this.solicitudes.values()]
      .filter((s) => s.tenantId === ctx.tenantId && s.clienteId === clienteId && (!estado || s.estado === estado))
      .sort((a, b) => new Date(b.fechaCreacion) - new Date(a.fechaCreacion))
      .map((s) => new Solicitud(s));
  }

  async updateEstado(ctx, id, estado) {
    const found = this.solicitudes.get(id);
    if (!found || found.tenantId !== ctx.tenantId) return null;
    const updated = new Solicitud({ ...found, estado, fechaActualizacion: new Date().toISOString() });
    this.solicitudes.set(id, updated);
    return new Solicitud(updated);
  }

  async transicionarEstado(ctx, id, desde, hacia) {
    const found = this.solicitudes.get(id);
    if (!found || found.tenantId !== ctx.tenantId || !desde.includes(found.estado)) return null;
    return this.updateEstado(ctx, id, hacia);
  }
}

module.exports = InMemorySolicitudRepository;
