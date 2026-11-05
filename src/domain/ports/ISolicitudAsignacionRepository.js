/**
 * Puerto de la asignación de una solicitud a un aliado (decisión 6A, SCRUM-1403): Dispatch decide quién acepta y
 * Core, dueño del estado, la registra. También expone la bandeja del aliado (SCRUM-1402/1404).
 */
class ISolicitudAsignacionRepository {
  /**
   * Asigna la solicitud al aliado de la sesión, de forma atómica e idempotente. Lanza un error de dominio con el
   * código MANI-SOL-* cuando la asignación no procede.
   * @param {{ tenantId: string, userId: string, role: string }} _ctx Sesión del aliado (del JWT que reenvía Dispatch).
   * @returns {Promise<{ solicitud: { id: string, estado: string, aliadoId: string, asignadaEn: Date },
   *                     asignada: boolean }>} `asignada` es false si ya era de este aliado (reintento).
   */
  async asignar(_ctx, _solicitudId) {
    throw new Error('Método asignar() no implementado en ISolicitudAsignacionRepository');
  }

  /**
   * Bandeja del aliado de la sesión: sus solicitudes asignadas (no canceladas) y las PENDIENTE sin asignar para
   * las que recibió una oferta. No filtra rechazos: son del dominio de Dispatch, que los quita (T1).
   * @returns {Promise<Array<object>>}
   */
  async ofertasDelAliado(_ctx) {
    throw new Error('Método ofertasDelAliado() no implementado en ISolicitudAsignacionRepository');
  }
}

module.exports = ISolicitudAsignacionRepository;
