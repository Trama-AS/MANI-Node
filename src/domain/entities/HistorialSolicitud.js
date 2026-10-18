/**
 * Entidad de dominio HistorialSolicitud / EventoServicio (RF-18 / US-04.3.2 / US-04.3.3).
 * Registra cronológicamente cambios de estado y eventos operativos del servicio.
 */
class HistorialSolicitud {
  constructor({
    id,
    solicitudId,
    usuarioId = null,
    estadoAnterior = null,
    estadoNuevo,
    observacion = null,
    fotoUrl = null,
    fecha = new Date().toISOString(),
  }) {
    this.id = id;
    this.solicitudId = solicitudId;
    this.usuarioId = usuarioId;
    this.estadoAnterior = estadoAnterior;
    this.estadoNuevo = estadoNuevo;
    this.observacion = observacion;
    this.fotoUrl = fotoUrl;
    this.fecha = fecha instanceof Date ? fecha.toISOString() : fecha;
  }

  toJSON() {
    return {
      id: this.id,
      solicitudId: this.solicitudId,
      usuarioId: this.usuarioId,
      estadoAnterior: this.estadoAnterior,
      estadoNuevo: this.estadoNuevo,
      observacion: this.observacion,
      fotoUrl: this.fotoUrl,
      fecha: this.fecha,
    };
  }
}

module.exports = HistorialSolicitud;
