/**
 * Entidad de dominio Solicitud / Servicio (RF-12, RF-14, RF-18 / US-04.*).
 */
class Solicitud {
  constructor({
    id,
    tenantId,
    clienteId,
    aliadoId = null,
    sitioId = null,
    categoriaId,
    zonaId,
    descripcion,
    direccion = null,
    fechaServicio = null,
    estado = 'CREADA',
    fechaCreacion = new Date().toISOString(),
    fechaInicioEjecucion = null,
    fechaFinEjecucion = null,
  }) {
    this.id = id;
    this.tenantId = tenantId;
    this.clienteId = clienteId;
    this.aliadoId = aliadoId;
    this.sitioId = sitioId;
    this.categoriaId = categoriaId;
    this.zonaId = zonaId;
    this.descripcion = descripcion;
    this.direccion = direccion;
    this.fechaServicio = fechaServicio instanceof Date ? fechaServicio.toISOString() : fechaServicio;
    this.estado = estado;
    this.fechaCreacion = fechaCreacion instanceof Date ? fechaCreacion.toISOString() : fechaCreacion;
    this.fechaInicioEjecucion = fechaInicioEjecucion instanceof Date ? fechaInicioEjecucion.toISOString() : fechaInicioEjecucion;
    this.fechaFinEjecucion = fechaFinEjecucion instanceof Date ? fechaFinEjecucion.toISOString() : fechaFinEjecucion;
  }

  toJSON() {
    return {
      id: this.id,
      tenantId: this.tenantId,
      clienteId: this.clienteId,
      aliadoId: this.aliadoId,
      sitioId: this.sitioId,
      categoriaId: this.categoriaId,
      zonaId: this.zonaId,
      descripcion: this.descripcion,
      direccion: this.direccion,
      fechaServicio: this.fechaServicio,
      estado: this.estado,
      fechaCreacion: this.fechaCreacion,
      fechaInicioEjecucion: this.fechaInicioEjecucion,
      fechaFinEjecucion: this.fechaFinEjecucion,
    };
  }
}

module.exports = Solicitud;
