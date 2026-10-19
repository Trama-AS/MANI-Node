/**
 * Puerto de persistencia de los eventos del servicio (`evento_servicio`, RF-18 / US-04.3.2 / US-04.3.3).
 * Todas las operaciones reciben el contexto verificado `ctx = { tenantId, userId, role }`.
 */
class IEventoServicioRepository {
  async create(_ctx, _evento) {
    throw new Error('Método create no implementado');
  }

  async findBySolicitudId(_ctx, _solicitudId) {
    throw new Error('Método findBySolicitudId no implementado');
  }
}

module.exports = IEventoServicioRepository;
