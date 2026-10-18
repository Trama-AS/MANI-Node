const crypto = require('crypto');
const ICotizacionRepository = require('../../domain/ports/ICotizacionRepository');
const Cotizacion = require('../../domain/entities/Cotizacion');

class InMemoryCotizacionRepository extends ICotizacionRepository {
  constructor() {
    super();
    this.cotizaciones = new Map();
  }

  async create(cotizacion) {
    const id = cotizacion.id || crypto.randomUUID();
    const entity = new Cotizacion({
      ...cotizacion,
      id,
    });
    this.cotizaciones.set(id, entity);
    return entity;
  }

  async findById(id) {
    const found = this.cotizaciones.get(id);
    return found ? new Cotizacion(found) : null;
  }

  async findBySolicitudId(solicitudId) {
    return [...this.cotizaciones.values()]
      .filter((c) => c.solicitudId === solicitudId)
      .sort((a, b) => a.version - b.version)
      .map((c) => new Cotizacion(c));
  }

  async update(cotizacion) {
    const existing = this.cotizaciones.get(cotizacion.id);
    if (!existing) return null;
    const updated = new Cotizacion({
      ...existing,
      ...cotizacion,
    });
    this.cotizaciones.set(cotizacion.id, updated);
    return updated;
  }
}

module.exports = InMemoryCotizacionRepository;
