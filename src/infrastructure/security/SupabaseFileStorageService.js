const IFileStorageService = require('../../domain/ports/IFileStorageService');
const { DomainError } = require('../../domain/errors/DomainError');

const BUCKET = 'kyc-documentos';
// Buckets que Core puede usar; las rutas siempre empiezan por {tenantId}/{usuarioId}/ (políticas de la 0007).
const BUCKETS_PERMITIDOS = new Set([BUCKET, 'solicitudes']);

function bucketValido(bucket) {
  if (!BUCKETS_PERMITIDOS.has(bucket)) {
    throw new DomainError(`Bucket de Storage no permitido: ${bucket}`, 'INTERNAL_ERROR', 500);
  }
  return bucket;
}

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

  async upload({ path, buffer, contentType, bucket = BUCKET }) {
    const destino = bucketValido(bucket);
    const client = this.supabaseClientFactory.getClient();
    const { error } = await client.storage.from(destino).upload(path, buffer, {
      contentType,
      upsert: false,
    });

    if (error) throw new DomainError(`Error subiendo documento a Storage: ${error.message}`, 'INTERNAL_ERROR', 500);
    return { path: `${destino}/${path}` };
  }

  async delete(path, { bucket = BUCKET } = {}) {
    const client = this.supabaseClientFactory.getClient();
    const { error } = await client.storage.from(bucketValido(bucket)).remove([path]);
    if (error) throw new DomainError(`Error eliminando documento de Storage: ${error.message}`, 'INTERNAL_ERROR', 500);
  }

  async createSignedUrl(path, expiresInSeconds = 300, { bucket = BUCKET } = {}) {
    const client = this.supabaseClientFactory.getClient();
    const destino = bucketValido(bucket);
    const cleanPath = String(path || '').replace(new RegExp(`^${destino}/`), '');
    const { data, error } = await client.storage.from(destino).createSignedUrl(cleanPath, expiresInSeconds);
    if (error || !data?.signedUrl) {
      throw new DomainError(
        `Error generando URL firmada de Storage: ${error?.message || 'sin URL'}`,
        'INTERNAL_ERROR',
        500
      );
    }
    return {
      signedUrl: data.signedUrl,
      expiresIn: expiresInSeconds,
    };
  }
}

module.exports = SupabaseFileStorageService;

