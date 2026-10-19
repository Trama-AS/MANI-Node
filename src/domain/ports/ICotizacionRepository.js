/**
 * Puerto de persistencia de cotizaciones (RF-15, RF-16, RF-17). Todas las operaciones reciben el contexto
 * verificado `ctx = { tenantId, userId, role }`: una cotización de otro tenant no existe para quien consulta.
 */
class ICotizacionRepository {
  async create(_ctx, _cotizacion) {
    throw new Error('Método create no implementado');
  }

  async findById(_ctx, _id) {
    throw new Error('Método findById no implementado');
  }

  async findBySolicitudId(_ctx, _solicitudId) {
    throw new Error('Método findBySolicitudId no implementado');
  }

  /**
   * Cambia el estado. Con `soloSiEstado` la transición es atómica: solo ocurre si la cotización sigue en ese
   * estado (dos respuestas simultáneas no se pisan). Devuelve null si no hubo fila que cambiar.
   */
  async updateEstado(_ctx, _id, _estado, _opciones = {}) {
    throw new Error('Método updateEstado no implementado');
  }
}

module.exports = ICotizacionRepository;
