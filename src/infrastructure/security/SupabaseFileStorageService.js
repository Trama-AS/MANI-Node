const IFileStorageService = require('../../domain/ports/IFileStorageService');
const { DomainError } = require('../../domain/errors/DomainError');

const BUCKET = 'kyc-documentos';

/**
 * Sube a Supabase Storage. El path DEBE empezar con `{tenantId}/{usuarioId}/`:
 * la política RLS `kyc_isolation` (database/migrations/007_normalizar_dominios.sql)
 * compara exactamente esos dos primeros segmentos de carpeta contra
 * app_metadata.tenant_id y auth.uid() — cualquier otro layout queda ilegible
 * para el propio aliado aunque la subida "funcione".
 */
class SupabaseFileStorageService extends IFileStorageService {
  constructor({ supabaseClientFactory }) {
    super();
    this.supabaseClientFactory = supabaseClientFactory;
  }

  async upload({ path, buffer, contentType }) {
    const client = this.supabaseClientFactory.getClient();
    const { error } = await client.storage.from(BUCKET).upload(path, buffer, {
      contentType,
      upsert: false,
    });

    if (error) throw new DomainError(`Error subiendo documento a Storage: ${error.message}`, 'INTERNAL_ERROR', 500);
    return { path: `${BUCKET}/${path}` };
  }

  async delete(path) {
    const client = this.supabaseClientFactory.getClient();
    const { error } = await client.storage.from(BUCKET).remove([path]);
    if (error) throw new DomainError(`Error eliminando documento de Storage: ${error.message}`, 'INTERNAL_ERROR', 500);
  }
}

module.exports = SupabaseFileStorageService;
