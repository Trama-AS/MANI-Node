const IUserConsentRepository = require('../../domain/ports/IUserConsentRepository');
const UserConsent = require('../../domain/entities/UserConsent');
const { DomainError } = require('../../domain/errors/DomainError');

class SupabaseUserConsentRepository extends IUserConsentRepository {
  constructor({ supabaseClientFactory }) {
    super();
    this.supabaseClientFactory = supabaseClientFactory;
  }

  async create(consent) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('consentimiento_usuario')
      .upsert(
        {
          tenant_id: consent.tenantId,
          usuario_id: consent.usuarioId,
          documento_legal_id: consent.documentoLegalId,
          ip_address: consent.ipAddress,
          user_agent: consent.userAgent,
        },
        { onConflict: 'usuario_id,documento_legal_id' }
      )
      .select()
      .single();

    if (error) {
      throw new DomainError(`Error registrando consentimiento de usuario: ${error.message}`, 'INTERNAL_ERROR', 500);
    }

    return new UserConsent({
      id: data.id,
      tenantId: data.tenant_id,
      usuarioId: data.usuario_id,
      documentoLegalId: data.documento_legal_id,
      ipAddress: data.ip_address,
      userAgent: data.user_agent,
      createdAt: data.created_at,
    });
  }

  async hasConsented(usuarioId, documentoLegalId) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('consentimiento_usuario')
      .select('id')
      .eq('usuario_id', usuarioId)
      .eq('documento_legal_id', documentoLegalId)
      .maybeSingle();

    if (error) {
      throw new DomainError(`Error verificando consentimiento: ${error.message}`, 'INTERNAL_ERROR', 500);
    }

    return Boolean(data);
  }

  async deleteByUsuarioId(tenantId, usuarioId) {
    const client = this.supabaseClientFactory.getClient();
    let query = client.from('consentimiento_usuario').delete().eq('usuario_id', usuarioId);
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }
    const { error } = await query;
    if (error) {
      throw new DomainError(`Error eliminando consentimientos de usuario: ${error.message}`, 'INTERNAL_ERROR', 500);
    }
  }
}

module.exports = SupabaseUserConsentRepository;
