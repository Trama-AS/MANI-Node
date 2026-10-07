/**
 * Interfaz / Puerto de Dominio para el almacenamiento de archivos (bucket
 * `kyc-documentos` en Supabase Storage; en memoria para DEV/test).
 */
class IFileStorageService {
  /**
   * @param {{ path: string, buffer: Buffer, contentType: string }} params
   * @returns {Promise<{ path: string }>}
   */
  async upload(_params) {
    throw new Error('Método upload() no implementado en IFileStorageService');
  }
}

module.exports = IFileStorageService;
