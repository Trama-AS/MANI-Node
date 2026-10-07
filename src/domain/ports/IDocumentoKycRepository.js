/**
 * Interfaz / Puerto de Dominio para persistencia de `documento_kyc`.
 */
class IDocumentoKycRepository {
  /** @param {Array<{tipoDocumento: string, rutaStorage: string}>} _documentos */
  async createMany(_tenantId, _aliadoId, _documentos) {
    throw new Error('Método createMany() no implementado en IDocumentoKycRepository');
  }
}

module.exports = IDocumentoKycRepository;
