/** Puerto de dominio para el contexto mínimo de una solicitud que Dispatch necesita (zona y categoría). */
class ISolicitudContextRepository {
  /** @returns {Promise<{ id: string, tenantId: string, zonaId: string, categoriaId: string, estado: string } | null>} */
  async findContext(_tenantId, _solicitudId) {
    throw new Error('Método findContext() no implementado en ISolicitudContextRepository');
  }
}

module.exports = ISolicitudContextRepository;
