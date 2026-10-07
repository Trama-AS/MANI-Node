/**
 * Interfaz / Puerto de Dominio para persistencia de `documento_kyc`.
 */
class IDocumentoKycRepository {
  /** @param {Array<{tipoDocumento: string, rutaStorage: string}>} _documentos */
  async createMany(_tenantId, _aliadoId, _documentos) {
    throw new Error('Método createMany() no implementado en IDocumentoKycRepository');
  }

  /** Compensación (B3): deshace createMany() si un paso posterior del registro falla. */
  async deleteByAliadoId(_tenantId, _aliadoId) {
    throw new Error('Método deleteByAliadoId() no implementado en IDocumentoKycRepository');
  }
}

module.exports = IDocumentoKycRepository;
