/**
 * Entidad de dominio Cotización (RF-15, RF-16, RF-17 / US-04.2.1 / SCRUM-865).
 * Mano de obra y materiales separados; el total se deriva de ambos. Refleja la tabla `cotizacion`.
 */
class Cotizacion {
  constructor({
    id,
    tenantId,
    solicitudId,
    aliadoId,
    valorManoObra,
    valorMateriales = 0,
    estado = 'PENDIENTE',
    version = 1,
    observacion = null,
    fechaCreacion = new Date().toISOString(),
  }) {
    this.id = id;
    this.tenantId = tenantId;
    this.solicitudId = solicitudId;
    this.aliadoId = aliadoId;
    this.valorManoObra = Number(valorManoObra);
    this.valorMateriales = Number(valorMateriales ?? 0);
    this.valor = Math.round((this.valorManoObra + this.valorMateriales) * 100) / 100;
    this.estado = estado;
    this.version = Number(version || 1);
    this.observacion = observacion;
    this.fechaCreacion = fechaCreacion instanceof Date ? fechaCreacion.toISOString() : fechaCreacion;
  }

  toJSON() {
    return {
      id: this.id,
      tenantId: this.tenantId,
      solicitudId: this.solicitudId,
      aliadoId: this.aliadoId,
      valorManoObra: this.valorManoObra,
      valorMateriales: this.valorMateriales,
      valor: this.valor,
      estado: this.estado,
      version: this.version,
      observacion: this.observacion,
      fechaCreacion: this.fechaCreacion,
    };
  }
}

module.exports = Cotizacion;
