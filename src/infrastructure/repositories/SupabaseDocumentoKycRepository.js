const IDocumentoKycRepository = require('../../domain/ports/IDocumentoKycRepository');
const { DomainError } = require('../../domain/errors/DomainError');

/**
 * Migración de la porción documento_kyc de registrar_aliado_persona_natural
 * (ADR-0022). Los documentos se insertan en estado PENDIENTE, igual que hacía
 * la función PL/pgSQL original (database/init/04-supabase-rls-and-functions.sql).
 */
class SupabaseDocumentoKycRepository extends IDocumentoKycRepository {
  constructor({ supabaseClientFactory }) {
    super();
    this.supabaseClientFactory = supabaseClientFactory;
  }

  async createMany(tenantId, aliadoId, documentos) {
    const client = this.supabaseClientFactory.getClient();
    const rows = documentos.map((d) => ({
      tenant_id: tenantId,
      aliado_id: aliadoId,
      tipo_documento: d.tipoDocumento,
      ruta_storage: d.rutaStorage,
      estado: 'PENDIENTE',
    }));

    const { data, error } = await client.from('documento_kyc').insert(rows).select();
    if (error) throw new DomainError(`Error guardando documentos KYC: ${error.message}`, 'INTERNAL_ERROR', 500);
    return data;
  }
}

module.exports = SupabaseDocumentoKycRepository;
