/**
 * Puerto de las adiciones por imprevisto (US-04.3.5 / SCRUM-872, RF-34).
 * Core es el dueño del estado del servicio después de la asignación (decisión 6A, SAD §7.4): la adición, el evento
 * en la bitácora y el aviso a la otra parte van en una sola transacción con el contexto de tenant del JWT (ADR-0032).
 * El total vigente del servicio es la cotización aceptada más las adiciones aceptadas; el pago (SCRUM-1432) cobra ese
 * total.
 */
class IAdditionRepository {
  /**
   * El aliado asignado pide una adición mientras el servicio está EN_EJECUCION.
   * @param {{ tenantId: string, userId: string, role: string }} _ctx contexto verificado
   * @param {{ solicitudId: string, motivo: string, valorManoObra: number, valorMateriales: number,
   *           tiempoAdicionalMinutos: number|null }} _datos datos ya validados
   * @returns {Promise<{ adicion: object, resumen: object, notificacionId?: string }>}
   */
  async solicitar(_ctx, _datos) {
    throw new Error('Método solicitar() no implementado en IAdditionRepository');
  }

  /**
   * Adiciones de la solicitud y su total vigente, para el cliente dueño o el aliado asignado.
   * @param {{ tenantId: string, userId: string, role: string }} _ctx contexto verificado
   * @param {string} _solicitudId
   * @returns {Promise<{ adiciones: object[], resumen: object }>}
   */
  async listarPorSolicitud(_ctx, _solicitudId) {
    throw new Error('Método listarPorSolicitud() no implementado en IAdditionRepository');
  }

  /**
   * El cliente dueño acepta o rechaza la adición pendiente.
   * @param {{ tenantId: string, userId: string, role: string }} _ctx contexto verificado
   * @param {{ adicionId: string, decision: { accion: string, adicion: string, evento: string },
   *           comentario: string }} _datos decisión ya validada
   * @returns {Promise<{ adicion: object, resumen: object, notificacionId?: string }>}
   */
  async responder(_ctx, _datos) {
    throw new Error('Método responder() no implementado en IAdditionRepository');
  }
}

module.exports = IAdditionRepository;
