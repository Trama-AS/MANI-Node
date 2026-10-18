const crypto = require('crypto');
const IHistorialSolicitudRepository = require('../../domain/ports/IHistorialSolicitudRepository');
const HistorialSolicitud = require('../../domain/entities/HistorialSolicitud');

class InMemoryHistorialSolicitudRepository extends IHistorialSolicitudRepository {
  constructor() {
    super();
    this.eventos = [];
  }

  async create(evento) {
    const id = evento.id || crypto.randomUUID();
    const entity = new HistorialSolicitud({
      ...evento,
      id,
      fecha: evento.fecha || new Date().toISOString(),
    });
    this.eventos.push(entity);
    return entity;
  }

  async findBySolicitudId(solicitudId) {
    return this.eventos
      .filter((e) => e.solicitudId === solicitudId)
      .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
      .map((e) => new HistorialSolicitud(e));
  }
}

module.exports = InMemoryHistorialSolicitudRepository;
