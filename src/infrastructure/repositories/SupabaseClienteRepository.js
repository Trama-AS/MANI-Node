const IClienteRepository = require('../../domain/ports/IClienteRepository');
const { DomainError } = require('../../domain/errors/DomainError');

/**
 * Migración de registrar_cliente_persona_natural + la rama "cliente" de
 * handle_new_user (US-02.2.1-M2). A diferencia de `aliado`, la tabla
 * `cliente` (database/init/01-schema.sql en MANI-APIGateway) no tiene
 * nombre_razon_social ni estado_verificacion: solo tenant_id/usuario_id/tipo.
 */
class SupabaseClienteRepository extends IClienteRepository {
  constructor({ supabaseClientFactory }) {
    super();
    this.supabaseClientFactory = supabaseClientFactory;
  }

  async create({ tenantId, usuarioId, tipo, razonSocial, nit, telefono, nombreRepresentante }) {
    const client = this.supabaseClientFactory.getClient();
    const row = { tenant_id: tenantId, usuario_id: usuarioId, tipo };
    // Columnas de organización (migración 0002), solo para el cliente empresa (HU-M02-07).
    if (razonSocial !== undefined) row.razon_social = razonSocial;
    if (nit !== undefined) row.nit = nit;
    if (telefono !== undefined) row.telefono = telefono;
    if (nombreRepresentante !== undefined) row.nombre_representante = nombreRepresentante;
    const { data, error } = await client
      .from('cliente')
      .upsert(row, { onConflict: 'usuario_id' })
      .select()
      .single();

    if (error) throw new DomainError(`Error creando cliente: ${error.message}`, 'INTERNAL_ERROR', 500);
    return data;
  }

  async findByNit(tenantId, nit) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('cliente')
      .select('id, usuario_id, nit')
      .eq('tenant_id', tenantId)
      .eq('nit', nit)
      // Sin índice único (tenant_id, nit) puede haber duplicados previos: limit(1) evita que maybeSingle()
      // falle y convierta el 409 esperado en un 500.
      .limit(1)
      .maybeSingle();
    if (error) throw new DomainError(`Error consultando cliente por NIT: ${error.message}`, 'INTERNAL_ERROR', 500);
    return data;
  }

  async deleteByUsuarioId(tenantId, usuarioId) {
    const client = this.supabaseClientFactory.getClient();
    const { error } = await client
      .from('cliente')
      .delete()
      .eq('tenant_id', tenantId)
      .eq('usuario_id', usuarioId);
    if (error) throw new DomainError(`Error eliminando cliente: ${error.message}`, 'INTERNAL_ERROR', 500);
  }
}

module.exports = SupabaseClienteRepository;
