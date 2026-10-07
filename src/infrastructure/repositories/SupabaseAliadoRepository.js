const IAliadoRepository = require('../../domain/ports/IAliadoRepository');
const { DomainError } = require('../../domain/errors/DomainError');
const { ESTADO_VERIFICACION_TO_DB } = require('./supabaseEnumMaps');

/**
 * Migración de registrar_aliado_persona_natural + la porción "aliado" de
 * handle_new_user (ADR-0022). Requiere las columnas tipo_documento_identidad /
 * numero_documento_identidad agregadas por db/migrations/0001_... .sql — sin
 * esa migración aplicada en el proyecto de Supabase, este repositorio falla.
 */
class SupabaseAliadoRepository extends IAliadoRepository {
  constructor({ supabaseClientFactory }) {
    super();
    this.supabaseClientFactory = supabaseClientFactory;
  }

  async findByDocumentNumber(tenantId, documentNumber) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('aliado')
      .select('id, usuario_id, numero_documento_identidad')
      .eq('tenant_id', tenantId)
      .eq('numero_documento_identidad', documentNumber)
      .maybeSingle();

    if (error) throw new DomainError(`Error consultando aliado: ${error.message}`, 'INTERNAL_ERROR', 500);
    return data;
  }

  async create({ tenantId, usuarioId, tipo, nombreRazonSocial, estadoVerificacion, documentType, documentNumber }) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('aliado')
      .upsert(
        {
          tenant_id: tenantId,
          usuario_id: usuarioId,
          tipo,
          nombre_razon_social: nombreRazonSocial,
          estado_verificacion: ESTADO_VERIFICACION_TO_DB[estadoVerificacion] || estadoVerificacion,
          tipo_documento_identidad: documentType,
          numero_documento_identidad: documentNumber,
        },
        { onConflict: 'usuario_id' }
      )
      .select()
      .single();

    if (error) throw new DomainError(`Error creando aliado: ${error.message}`, 'INTERNAL_ERROR', 500);
    return data;
  }

  async deleteByUsuarioId(tenantId, usuarioId) {
    const client = this.supabaseClientFactory.getClient();
    const { error } = await client
      .from('aliado')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('usuario_id', usuarioId);
    if (error) throw new DomainError(`Error eliminando aliado: ${error.message}`, 'INTERNAL_ERROR', 500);
  }
}

module.exports = SupabaseAliadoRepository;
