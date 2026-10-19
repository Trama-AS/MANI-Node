const crypto = require('crypto');
const ICotizacionRepository = require('../../domain/ports/ICotizacionRepository');
const Cotizacion = require('../../domain/entities/Cotizacion');

/** Adaptador en memoria (DEV/test sin DATABASE_URL). Mismo aislamiento por tenant que el real. */
class InMemoryCotizacionRepository extends ICotizacionRepository {
  constructor() {
    super();
    this.cotizaciones = new Map();
  }

  async create(ctx, cotizacion) {
    const entity = new Cotizacion({ ...cotizacion, id: cotizacion.id || crypto.randomUUID(), tenantId: ctx.tenantId });
    this.cotizaciones.set(entity.id, entity);
    return new Cotizacion(entity);
  }

  async findById(ctx, id) {
    const found = this.cotizaciones.get(id);
    return found && found.tenantId === ctx.tenantId ? new Cotizacion(found) : null;
  }

  async findBySolicitudId(ctx, solicitudId) {
    return [...this.cotizaciones.values()]
      .filter((c) => c.solicitudId === solicitudId && c.tenantId === ctx.tenantId)
      .sort((a, b) => a.version - b.version)
      .map((c) => new Cotizacion(c));
  }

  async updateEstado(ctx, id, estado) {
    const found = this.cotizaciones.get(id);
    if (!found || found.tenantId !== ctx.tenantId) return null;
    const updated = new Cotizacion({ ...found, estado });
    this.cotizaciones.set(id, updated);
    return new Cotizacion(updated);
  }
}

module.exports = InMemoryCotizacionRepository;
