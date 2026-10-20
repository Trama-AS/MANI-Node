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

  async findByUsuarioId(tenantId, usuarioId) {
    const client = this.supabaseClientFactory.getClient();
    let query = client
      .from('aliado')
      .select('id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion')
      .eq('usuario_id', usuarioId);
    if (tenantId) query = query.eq('tenant_id', tenantId);

    const { data, error } = await query.maybeSingle();
    if (error) throw new DomainError(`Error consultando aliado: ${error.message}`, 'INTERNAL_ERROR', 500);
    return data;
  }

  async create({
    tenantId,
    usuarioId,
    tipo,
    nombreRazonSocial,
    estadoVerificacion,
    documentType,
    documentNumber,
    nombreRepresentante,
    docRepresentante,
  }) {
    const client = this.supabaseClientFactory.getClient();
    const payload = {
      tenant_id: tenantId,
      usuario_id: usuarioId,
      tipo,
      nombre_razon_social: nombreRazonSocial,
      estado_verificacion: ESTADO_VERIFICACION_TO_DB[estadoVerificacion] || estadoVerificacion,
      tipo_documento_identidad: documentType,
      numero_documento_identidad: documentNumber,
    };
    if (nombreRepresentante) payload.nombre_representante_legal = nombreRepresentante;
    if (docRepresentante) payload.documento_representante_legal = docRepresentante;

    const { data, error } = await client
      .from('aliado')
      .upsert(payload, { onConflict: 'usuario_id' })
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

  async findById(tenantId, aliadoId) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('aliado')
      .select(
        'id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion, motivo_rechazo, fecha_verificacion, created_at'
      )
      .eq('tenant_id', tenantId)
      .eq('id', aliadoId)
      .maybeSingle();

    if (error) throw new DomainError(`Error consultando aliado: ${error.message}`, 'INTERNAL_ERROR', 500);
    return data;
  }

  async findByTenant(tenantId, { estadoVerificacion } = {}) {
    const client = this.supabaseClientFactory.getClient();
    let query = client
      .from('aliado')
      .select(
        'id, tenant_id, usuario_id, tipo, nombre_razon_social, estado_verificacion, motivo_rechazo, fecha_verificacion, created_at'
      )
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: true });

    if (estadoVerificacion) {
      const dbEstado = ESTADO_VERIFICACION_TO_DB[estadoVerificacion] || estadoVerificacion;
      query = query.eq('estado_verificacion', dbEstado);
    }

    const { data, error } = await query;
    if (error) throw new DomainError(`Error listando aliados: ${error.message}`, 'INTERNAL_ERROR', 500);
    return data || [];
  }

  async updateVerificationStatus(
    tenantId,
    aliadoId,
    { estadoVerificacion, motivoRechazo = null, fechaVerificacion, verificadoPor = null }
  ) {
    const client = this.supabaseClientFactory.getClient();
    const dbEstado = ESTADO_VERIFICACION_TO_DB[estadoVerificacion] || estadoVerificacion;
    const { data, error } = await client
      .from('aliado')
      .update({
        estado_verificacion: dbEstado,
        motivo_rechazo: motivoRechazo,
        fecha_verificacion: fechaVerificacion || new Date().toISOString(),
        // CA-5: quién resolvió la verificación queda en la base, no solo en el log.
        verificado_por: verificadoPor,
      })
      .eq('tenant_id', tenantId)
      .eq('id', aliadoId)
      .eq('estado_verificacion', 'PENDIENTE')
      .select()
      .maybeSingle();

    if (error) throw new DomainError(`Error actualizando verificación de aliado: ${error.message}`, 'INTERNAL_ERROR', 500);
    return data;
  }
}

module.exports = SupabaseAliadoRepository;

