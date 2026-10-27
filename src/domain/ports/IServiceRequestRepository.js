/**
 * Puerto de creación de solicitudes de servicio en Core (US-04.1.1-M2 / SCRUM-1072, ADR-0022).
 * Porta la función PL/pgSQL `crear_solicitud`: la regla vive en el servicio y la persistencia es una sola
 * transacción con el contexto de tenant del JWT.
 */
class IServiceRequestRepository {
  /**
   * @param {{ tenantId: string, userId: string, role: string }} _ctx contexto verificado
   * @param {{ categoriaId: string, descripcion: string, sitioId?: string, direccion?: string, zonaId?: string,
   *           fotos: string[], claveIdempotencia?: string }} _datos rutas de fotos ya subidas al bucket `solicitudes`
   * @returns {Promise<{ solicitud: object, creada: boolean }>} `creada` es false si la clave de idempotencia ya existía
   */
  async crear(_ctx, _datos) {
    throw new Error('Método crear() no implementado en IServiceRequestRepository');
  }

  /**
   * Solicitudes del cliente de la sesión (SCRUM-871), de la más reciente a la más antigua.
   * @param {{ tenantId: string, userId: string, role: string }} _ctx contexto verificado
   * @returns {Promise<object[]>}
   */
  async listarDelCliente(_ctx) {
    throw new Error('Método listarDelCliente() no implementado en IServiceRequestRepository');
  }

  /**
   * Una solicitud del cliente de la sesión, o `null` si no existe o es de otro cliente o tenant (SCRUM-871).
   * @param {{ tenantId: string, userId: string, role: string }} _ctx contexto verificado
   * @param {string} _id
   * @returns {Promise<object|null>}
   */
  async obtenerDelCliente(_ctx, _id) {
    throw new Error('Método obtenerDelCliente() no implementado en IServiceRequestRepository');
  }
}

module.exports = IServiceRequestRepository;
