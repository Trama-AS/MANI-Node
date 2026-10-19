/**
 * Entidad de dominio Evento del servicio (RF-18 / US-04.3.x). Refleja la tabla `evento_servicio`:
 * registro cronológico de lo que pasa con la solicitud (cotización enviada, cambios de estado, imprevistos).
 * `actorId` es el `usuario.id` de quien originó el evento.
 */
class EventoServicio {
  constructor({ id, tenantId, solicitudId, actorId, tipoEvento, descripcion = null, evidenciaRuta = null, fecha = new Date().toISOString() }) {
    this.id = id;
    this.tenantId = tenantId;
    this.solicitudId = solicitudId;
    this.actorId = actorId;
    this.tipoEvento = tipoEvento;
    this.descripcion = descripcion;
    this.evidenciaRuta = evidenciaRuta;
    this.fecha = fecha instanceof Date ? fecha.toISOString() : fecha;
  }

  toJSON() {
    return {
      id: this.id,
      solicitudId: this.solicitudId,
      actorId: this.actorId,
      tipoEvento: this.tipoEvento,
      descripcion: this.descripcion,
      evidenciaRuta: this.evidenciaRuta,
      fecha: this.fecha,
    };
  }
}

module.exports = EventoServicio;
