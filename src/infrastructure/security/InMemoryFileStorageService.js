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
}

module.exports = InMemoryFileStorageService;
