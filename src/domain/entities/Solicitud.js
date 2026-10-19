/**
 * Entidad de dominio Solicitud (RF-12, RF-14, RF-18 / US-04.*). Refleja las columnas reales de `solicitud`.
 * `aliadoId` es `aliado.id` (no el id del usuario) y lo fija Dispatch al aceptar (ADR-0016).
 */
class Solicitud {
  constructor({
    id,
    tenantId,
    clienteId,
    sitioId = null,
    categoriaId,
    zonaId,
    aliadoId = null,
    descripcion = null,
    estado,
    fechaCreacion = new Date().toISOString(),
    fechaActualizacion = null,
  }) {
    this.id = id;
    this.tenantId = tenantId;
    this.clienteId = clienteId;
    this.sitioId = sitioId;
    this.categoriaId = categoriaId;
    this.zonaId = zonaId;
    this.aliadoId = aliadoId;
    this.descripcion = descripcion;
    this.estado = estado;
    this.fechaCreacion = fechaCreacion instanceof Date ? fechaCreacion.toISOString() : fechaCreacion;
    this.fechaActualizacion = fechaActualizacion instanceof Date ? fechaActualizacion.toISOString() : fechaActualizacion;
  }

  toJSON() {
    return {
      id: this.id,
      tenantId: this.tenantId,
      clienteId: this.clienteId,
      sitioId: this.sitioId,
      categoriaId: this.categoriaId,
      zonaId: this.zonaId,
      aliadoId: this.aliadoId,
      descripcion: this.descripcion,
      estado: this.estado,
      fechaCreacion: this.fechaCreacion,
      fechaActualizacion: this.fechaActualizacion,
    };
  }
}

module.exports = Solicitud;
