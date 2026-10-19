const crypto = require('crypto');
const IEventoServicioRepository = require('../../domain/ports/IEventoServicioRepository');
const EventoServicio = require('../../domain/entities/EventoServicio');

/** Adaptador en memoria (DEV/test sin DATABASE_URL). Mismo aislamiento por tenant que el real. */
class InMemoryEventoServicioRepository extends IEventoServicioRepository {
  constructor() {
    super();
    this.eventos = [];
  }

  async create(ctx, evento) {
    const entity = new EventoServicio({ ...evento, id: crypto.randomUUID(), tenantId: ctx.tenantId });
    this.eventos.push(entity);
    return new EventoServicio(entity);
  }

  async findBySolicitudId(ctx, solicitudId) {
    return this.eventos
      .filter((e) => e.tenantId === ctx.tenantId && e.solicitudId === solicitudId)
      .sort((a, b) => new Date(a.fecha) - new Date(b.fecha))
      .map((e) => new EventoServicio(e));
  }
}

module.exports = InMemoryEventoServicioRepository;
