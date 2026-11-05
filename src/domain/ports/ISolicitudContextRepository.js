/** Puerto de dominio para el contexto mínimo de una solicitud que Dispatch necesita (zona, categoría y estado). */
class ISolicitudContextRepository {
  /**
   * Devuelve null si la solicitud no existe en el tenant o si la sesión no es su cliente dueño, un admin del
   * tenant, su aliado asignado o un aliado con oferta de despacho para ella.
   * @param {{ tenantId: string, userId: string, role: string }} _ctx Contexto verificado de la sesión.
   * @returns {Promise<{ id: string, tenantId: string, zonaId: string, categoriaId: string, estado: string,
   *                     esMia: boolean } | null>}
   */
  async findContext(_ctx, _solicitudId) {
    throw new Error('Método findContext() no implementado en ISolicitudContextRepository');
  }
}

module.exports = ISolicitudContextRepository;
