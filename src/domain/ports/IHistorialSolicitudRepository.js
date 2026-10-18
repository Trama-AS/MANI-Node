/**
 * Puerto para persistencia del historial de eventos de la solicitud (RF-18 / US-04.3.2 / US-04.3.3).
 */
class IHistorialSolicitudRepository {
  async create(_evento) {
    throw new Error('Método create no implementado');
  }

  async findBySolicitudId(_solicitudId) {
    throw new Error('Método findBySolicitudId no implementado');
  }
}

module.exports = IHistorialSolicitudRepository;
