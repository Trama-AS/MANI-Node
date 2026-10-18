/**
 * Puerto para persistencia de Solicitudes de Servicio (RF-12, RF-14, RF-18, RF-19).
 */
class ISolicitudRepository {
  async create(_solicitud) {
    throw new Error('Método create no implementado');
  }

  async findById(_id) {
    throw new Error('Método findById no implementado');
  }

  async findByClienteId(_clienteId, _options = {}) {
    throw new Error('Método findByClienteId no implementado');
  }

  async findByAliadoId(_aliadoId, _options = {}) {
    throw new Error('Método findByAliadoId no implementado');
  }

  async update(_solicitud) {
    throw new Error('Método update no implementado');
  }
}

module.exports = ISolicitudRepository;
