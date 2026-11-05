/**
 * Puerto de las lecturas que el cliente necesita para crear una solicitud (TEC-18 / SCRUM-1465).
 * Reemplaza a las RPC `listar_categorias_cliente` y `listar_mis_sitios` (006): el cliente se resuelve por el
 * usuario del JWT dentro del contexto de tenant (ADR-0032), sea persona natural o empresa.
 */
class IRequestFormRepository {
  /**
   * @param {{ tenantId: string, userId: string, role: string }} _ctx contexto verificado
   * @returns {Promise<Array<{ id: string, nombre: string, flujoOperativo: string }>>} categorías ACTIVO del tenant
   */
  async listarCategorias(_ctx) {
    throw new Error('Método listarCategorias() no implementado en IRequestFormRepository');
  }

  /**
   * @param {{ tenantId: string, userId: string, role: string }} _ctx contexto verificado
   * @returns {Promise<object[]>} sitios del cliente de la sesión con su zona y zona padre
   */
  async listarSitios(_ctx) {
    throw new Error('Método listarSitios() no implementado en IRequestFormRepository');
  }
}

module.exports = IRequestFormRepository;
