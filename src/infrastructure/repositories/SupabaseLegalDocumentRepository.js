const ILegalDocumentRepository = require('../../domain/ports/ILegalDocumentRepository');
const LegalDocument = require('../../domain/entities/LegalDocument');
const { DomainError } = require('../../domain/errors/DomainError');

class SupabaseLegalDocumentRepository extends ILegalDocumentRepository {
  constructor({ supabaseClientFactory }) {
    super();
    this.supabaseClientFactory = supabaseClientFactory;
  }

  async getActiveDocuments(tenantId) {
    const client = this.supabaseClientFactory.getClient();
    let query = client.from('documento_legal').select('*').eq('is_active', true);

    if (tenantId) {
      query = query.or(`tenant_id.eq.${tenantId},tenant_id.is.null`);
    } else {
      query = query.is('tenant_id', null);
    }

    const { data, error } = await query;
    if (error) {
      throw new DomainError(`Error consultando documentos legales: ${error.message}`, 'INTERNAL_ERROR', 500);
    }

    return (data || []).map(
      (row) =>
        new LegalDocument({
          id: row.id,
          tenantId: row.tenant_id,
          tipo: row.tipo,
          version: row.version,
          contenido: row.contenido,
          isActive: row.is_active,
          createdAt: row.created_at,
        })
    );
  }

  async findById(id) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client.from('documento_legal').select('*').eq('id', id).maybeSingle();

    if (error) {
      throw new DomainError(`Error consultando documento legal: ${error.message}`, 'INTERNAL_ERROR', 500);
    }

    if (!data) return null;

    return new LegalDocument({
      id: data.id,
      tenantId: data.tenant_id,
      tipo: data.tipo,
      version: data.version,
      contenido: data.contenido,
      isActive: data.is_active,
      createdAt: data.created_at,
    });
  }
}

module.exports = SupabaseLegalDocumentRepository;
