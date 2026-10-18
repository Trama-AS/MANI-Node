/**
 * Entidad de dominio Cotización (RF-15, RF-16, RF-17 / US-04.2.1 / SCRUM-865).
 * Separa de manera estructurada mano de obra y materiales, total exacto y trazabilidad contra el tarifario.
 */
class Cotizacion {
  constructor({
    id,
    solicitudId,
    aliadoId,
    tarifaId = null,
    valorManoObra,
    valorMateriales = 0,
    valor,
    moneda = 'COP',
    fueraDeRango = false,
    estado = 'PENDIENTE',
    version = 1,
    observacion = null,
    fechaCreacion = new Date().toISOString(),
    fechaExpiracion = null,
  }) {
    this.id = id;
    this.solicitudId = solicitudId;
    this.aliadoId = aliadoId;
    this.tarifaId = tarifaId;
    this.valorManoObra = Number(valorManoObra);
    this.valorMateriales = Number(valorMateriales ?? 0);
    this.valor = valor !== undefined ? Number(valor) : this.valorManoObra + this.valorMateriales;
    this.moneda = moneda;
    this.fueraDeRango = Boolean(fueraDeRango);
    this.estado = estado;
    this.version = Number(version || 1);
    this.observacion = observacion;
    this.fechaCreacion = fechaCreacion instanceof Date ? fechaCreacion.toISOString() : fechaCreacion;
    this.fechaExpiracion = fechaExpiracion instanceof Date ? fechaExpiracion.toISOString() : fechaExpiracion;
  }

  toJSON() {
    return {
      id: this.id,
      solicitudId: this.solicitudId,
      aliadoId: this.aliadoId,
      tarifaId: this.tarifaId,
      valorManoObra: this.valorManoObra,
      valorMateriales: this.valorMateriales,
      valor: this.valor,
      moneda: this.moneda,
      fueraDeRango: this.fueraDeRango,
      estado: this.estado,
      version: this.version,
      observacion: this.observacion,
      fechaCreacion: this.fechaCreacion,
      fechaExpiracion: this.fechaExpiracion,
    };
  }
}

module.exports = Cotizacion;
