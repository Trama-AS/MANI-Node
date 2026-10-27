/**
 * Interfaz / Puerto de Dominio para el almacenamiento de archivos (bucket
 * `kyc-documentos` en Supabase Storage; en memoria para DEV/test).
 */
class IFileStorageService {
  /**
   * @param {{ path: string, buffer: Buffer, contentType: string, bucket?: string }} params
   *   `bucket` por omisión es `kyc-documentos`; también se admite `solicitudes`.
   * @returns {Promise<{ path: string }>}
   */
  async upload(_params) {
    throw new Error('Método upload() no implementado en IFileStorageService');
  }

  /** Compensación (B3): deshace upload() si un paso posterior del registro falla. */
  async delete(_path) {
    throw new Error('Método delete() no implementado en IFileStorageService');
  }

  /**
   * @param {string} _path ruta dentro del bucket
   * @param {number} [_expiresInSeconds]
   * @param {{ bucket?: string }} [_opciones] bucket del objeto; por omisión `kyc-documentos`
   * @returns {Promise<{ signedUrl: string, expiresIn: number }>}
   */
  async createSignedUrl(_path, _expiresInSeconds, _opciones) {
    throw new Error('Método createSignedUrl() no implementado en IFileStorageService');
  }
}

module.exports = IFileStorageService;

