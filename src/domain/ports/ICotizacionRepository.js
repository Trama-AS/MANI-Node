/**
 * Puerto para persistencia de Cotizaciones (RF-15, RF-16, RF-17).
 */
class ICotizacionRepository {
  async create(_cotizacion) {
    throw new Error('Método create no implementado');
  }

  async findById(_id) {
    throw new Error('Método findById no implementado');
  }

  async findBySolicitudId(_solicitudId) {
    throw new Error('Método findBySolicitudId no implementado');
  }

  async update(_cotizacion) {
    throw new Error('Método update no implementado');
  }
}

module.exports = ICotizacionRepository;
