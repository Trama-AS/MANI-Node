/**
 * Interfaz / Puerto de Dominio para persistencia de documentos legales (términos y condiciones, habeas data).
 */
class ILegalDocumentRepository {
  /**
   * Obtiene todos los documentos legales activos aplicables al tenant (o globales).
   * @param {string} _tenantId
   * @returns {Promise<Array<import('../entities/LegalDocument')>>}
   */
  async getActiveDocuments(_tenantId) {
    throw new Error('Método getActiveDocuments() no implementado en ILegalDocumentRepository');
  }

  /**
   * Obtiene un documento legal por su identificador.
   * @param {string} _id
   * @returns {Promise<import('../entities/LegalDocument')|null>}
   */
  async findById(_id) {
    throw new Error('Método findById() no implementado en ILegalDocumentRepository');
  }
}

module.exports = ILegalDocumentRepository;
