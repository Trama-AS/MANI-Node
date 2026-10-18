const ICotizacionRepository = require('../../domain/ports/ICotizacionRepository');
const Cotizacion = require('../../domain/entities/Cotizacion');
const { DomainError } = require('../../domain/errors/DomainError');

function mapRowToCotizacion(row) {
  if (!row) return null;
  return new Cotizacion({
    id: row.id || row.id_cotizacion,
    solicitudId: row.solicitud_id || row.id_solicitud,
    aliadoId: row.aliado_id || row.id_aliado,
    tarifaId: row.tarifa_id || row.id_tarifa,
    valorManoObra: row.valor_mano_obra,
    valorMateriales: row.valor_materiales,
    valor: row.valor,
    moneda: row.moneda,
    fueraDeRango: row.fuera_de_rango,
    estado: row.estado,
    version: row.version,
    observacion: row.observacion,
    fechaCreacion: row.fecha_creacion || row.created_at,
    fechaExpiracion: row.fecha_expiracion,
  });
}

class SupabaseCotizacionRepository extends ICotizacionRepository {
  constructor({ supabaseClientFactory }) {
    super();
    this.supabaseClientFactory = supabaseClientFactory;
  }

  async create(cotizacion) {
    const client = this.supabaseClientFactory.getClient();
    const payload = {
      id: cotizacion.id,
      id_solicitud: cotizacion.solicitudId,
      id_aliado: cotizacion.aliadoId,
      id_tarifa: cotizacion.tarifaId,
      valor_mano_obra: cotizacion.valorManoObra,
      valor_materiales: cotizacion.valorMateriales,
      valor: cotizacion.valor,
      moneda: cotizacion.moneda,
      fuera_de_rango: cotizacion.fueraDeRango,
      estado: cotizacion.estado,
      version: cotizacion.version,
      observacion: cotizacion.observacion,
      fecha_creacion: cotizacion.fechaCreacion,
      fecha_expiracion: cotizacion.fechaExpiracion,
    };

    const { data, error } = await client
      .from('cotizacion')
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new DomainError(`Error persistiendo cotización: ${error.message}`, 'INTERNAL_ERROR', 500);
    }
    return mapRowToCotizacion(data);
  }

  async findById(id) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('cotizacion')
      .select('*')
      .or(`id.eq.${id},id_cotizacion.eq.${id}`)
      .maybeSingle();

    if (error) {
      throw new DomainError(`Error consultando cotización: ${error.message}`, 'INTERNAL_ERROR', 500);
    }
    return mapRowToCotizacion(data);
  }

  async findBySolicitudId(solicitudId) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('cotizacion')
      .select('*')
      .or(`solicitud_id.eq.${solicitudId},id_solicitud.eq.${solicitudId}`)
      .order('version', { ascending: true });

    if (error) {
      throw new DomainError(`Error consultando cotizaciones de solicitud: ${error.message}`, 'INTERNAL_ERROR', 500);
    }
    return (data || []).map(mapRowToCotizacion);
  }

  async update(cotizacion) {
    const client = this.supabaseClientFactory.getClient();
    const payload = {
      estado: cotizacion.estado,
      fuera_de_rango: cotizacion.fueraDeRango,
      observacion: cotizacion.observacion,
    };

    const { data, error } = await client
      .from('cotizacion')
      .update(payload)
      .or(`id.eq.${cotizacion.id},id_cotizacion.eq.${cotizacion.id}`)
      .select()
      .single();

    if (error) {
      throw new DomainError(`Error actualizando cotización: ${error.message}`, 'INTERNAL_ERROR', 500);
    }
    return mapRowToCotizacion(data);
  }
}

module.exports = SupabaseCotizacionRepository;
