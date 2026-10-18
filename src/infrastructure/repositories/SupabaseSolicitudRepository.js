const ISolicitudRepository = require('../../domain/ports/ISolicitudRepository');
const Solicitud = require('../../domain/entities/Solicitud');
const { DomainError } = require('../../domain/errors/DomainError');

function mapRowToSolicitud(row) {
  if (!row) return null;
  return new Solicitud({
    id: row.id || row.id_solicitud,
    tenantId: row.tenant_id || row.id_tenant,
    clienteId: row.cliente_id || row.id_cliente,
    aliadoId: row.aliado_id || row.id_aliado,
    sitioId: row.sitio_id || row.id_sitio,
    categoriaId: row.categoria_id || row.id_categoria,
    zonaId: row.zona_id || row.id_zona,
    descripcion: row.descripcion,
    direccion: row.direccion,
    fechaServicio: row.fecha_servicio,
    estado: row.estado,
    fechaCreacion: row.fecha_creacion || row.created_at,
    fechaInicioEjecucion: row.fecha_inicio_ejecucion,
    fechaFinEjecucion: row.fecha_fin_ejecucion,
  });
}

class SupabaseSolicitudRepository extends ISolicitudRepository {
  constructor({ supabaseClientFactory }) {
    super();
    this.supabaseClientFactory = supabaseClientFactory;
  }

  async create(solicitud) {
    const client = this.supabaseClientFactory.getClient();
    const payload = {
      id: solicitud.id,
      id_tenant: solicitud.tenantId,
      id_cliente: solicitud.clienteId,
      id_aliado: solicitud.aliadoId,
      id_sitio: solicitud.sitioId,
      id_categoria: solicitud.categoriaId,
      id_zona: solicitud.zonaId,
      descripcion: solicitud.descripcion,
      direccion: solicitud.direccion,
      fecha_servicio: solicitud.fechaServicio,
      estado: solicitud.estado,
      fecha_creacion: solicitud.fechaCreacion,
    };

    const { data, error } = await client
      .from('solicitud')
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new DomainError(`Error persistiendo solicitud: ${error.message}`, 'INTERNAL_ERROR', 500);
    }
    return mapRowToSolicitud(data);
  }

  async findById(id) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('solicitud')
      .select('*')
      .or(`id.eq.${id},id_solicitud.eq.${id}`)
      .maybeSingle();

    if (error) {
      throw new DomainError(`Error consultando solicitud: ${error.message}`, 'INTERNAL_ERROR', 500);
    }
    return mapRowToSolicitud(data);
  }

  async findByClienteId(clienteId, { tenantId, estado } = {}) {
    const client = this.supabaseClientFactory.getClient();
    let query = client
      .from('solicitud')
      .select('*')
      .or(`cliente_id.eq.${clienteId},id_cliente.eq.${clienteId}`);

    if (tenantId) {
      query = query.or(`tenant_id.eq.${tenantId},id_tenant.eq.${tenantId}`);
    }
    if (estado) {
      query = query.eq('estado', estado);
    }

    const { data, error } = await query.order('fecha_creacion', { ascending: false });

    if (error) {
      throw new DomainError(`Error consultando historial de solicitudes: ${error.message}`, 'INTERNAL_ERROR', 500);
    }
    return (data || []).map(mapRowToSolicitud);
  }

  async findByAliadoId(aliadoId, { tenantId, estado } = {}) {
    const client = this.supabaseClientFactory.getClient();
    let query = client
      .from('solicitud')
      .select('*')
      .or(`aliado_id.eq.${aliadoId},id_aliado.eq.${aliadoId}`);

    if (tenantId) {
      query = query.or(`tenant_id.eq.${tenantId},id_tenant.eq.${tenantId}`);
    }
    if (estado) {
      query = query.eq('estado', estado);
    }

    const { data, error } = await query.order('fecha_creacion', { ascending: false });

    if (error) {
      throw new DomainError(`Error consultando solicitudes de aliado: ${error.message}`, 'INTERNAL_ERROR', 500);
    }
    return (data || []).map(mapRowToSolicitud);
  }

  async update(solicitud) {
    const client = this.supabaseClientFactory.getClient();
    const payload = {
      estado: solicitud.estado,
      id_aliado: solicitud.aliadoId,
      fecha_inicio_ejecucion: solicitud.fechaInicioEjecucion,
      fecha_fin_ejecucion: solicitud.fechaFinEjecucion,
    };

    const { data, error } = await client
      .from('solicitud')
      .update(payload)
      .or(`id.eq.${solicitud.id},id_solicitud.eq.${solicitud.id}`)
      .select()
      .single();

    if (error) {
      throw new DomainError(`Error actualizando solicitud: ${error.message}`, 'INTERNAL_ERROR', 500);
    }
    return mapRowToSolicitud(data);
  }
}

module.exports = SupabaseSolicitudRepository;
