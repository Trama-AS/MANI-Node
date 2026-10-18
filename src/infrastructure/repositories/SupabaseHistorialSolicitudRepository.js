const IHistorialSolicitudRepository = require('../../domain/ports/IHistorialSolicitudRepository');
const HistorialSolicitud = require('../../domain/entities/HistorialSolicitud');
const { DomainError } = require('../../domain/errors/DomainError');

function mapRowToHistorial(row) {
  if (!row) return null;
  return new HistorialSolicitud({
    id: row.id || row.id_historial,
    solicitudId: row.solicitud_id || row.id_solicitud,
    usuarioId: row.usuario_id || row.id_usuario,
    estadoAnterior: row.estado_anterior,
    estadoNuevo: row.estado_nuevo,
    observacion: row.observacion,
    fotoUrl: row.foto_url,
    fecha: row.fecha || row.created_at,
  });
}

class SupabaseHistorialSolicitudRepository extends IHistorialSolicitudRepository {
  constructor({ supabaseClientFactory }) {
    super();
    this.supabaseClientFactory = supabaseClientFactory;
  }

  async create(evento) {
    const client = this.supabaseClientFactory.getClient();
    const payload = {
      id: evento.id,
      id_solicitud: evento.solicitudId,
      id_usuario: evento.usuarioId,
      estado_anterior: evento.estadoAnterior,
      estado_nuevo: evento.estadoNuevo,
      observacion: evento.observacion,
      foto_url: evento.fotoUrl,
      fecha: evento.fecha,
    };

    const { data, error } = await client
      .from('historial_solicitud')
      .insert(payload)
      .select()
      .single();

    if (error) {
      throw new DomainError(`Error registrando historial de solicitud: ${error.message}`, 'INTERNAL_ERROR', 500);
    }
    return mapRowToHistorial(data);
  }

  async findBySolicitudId(solicitudId) {
    const client = this.supabaseClientFactory.getClient();
    const { data, error } = await client
      .from('historial_solicitud')
      .select('*')
      .or(`solicitud_id.eq.${solicitudId},id_solicitud.eq.${solicitudId}`)
      .order('fecha', { ascending: true });

    if (error) {
      throw new DomainError(`Error consultando historial de solicitud: ${error.message}`, 'INTERNAL_ERROR', 500);
    }
    return (data || []).map(mapRowToHistorial);
  }
}

module.exports = SupabaseHistorialSolicitudRepository;
