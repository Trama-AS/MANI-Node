const IFileStorageService = require('../../domain/ports/IFileStorageService');

/** Sustituto de Supabase Storage para DEV/test: guarda los bytes en memoria. */
class InMemoryFileStorageService extends IFileStorageService {
  constructor() {
    super();
    this.files = new Map();
  }

  async upload({ path, buffer }) {
    this.files.set(path, buffer);
    return { path };
  }

  async delete(path) {
    this.files.delete(path);
  }

  async createSignedUrl(path, expiresInSeconds = 300) {
    const cleanPath = String(path || '').replace(/^kyc-documentos\//, '');
    return {
      signedUrl: `https://storage.mani.local/kyc-documentos/${cleanPath}?token=signed-temp-token&expiresIn=${expiresInSeconds}`,
      expiresIn: expiresInSeconds,
    };
  }
}

module.exports = InMemoryFileStorageService;

