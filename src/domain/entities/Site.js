/**
 * Entidad de Dominio: Sitio de Servicio (Site)
 * Representa una sede, sucursal o dirección física donde se ejecutan servicios (RF-08 / RF-09).
 */
class Site {
  /**
   * @param {object} data
   * @param {string} [data.id]
   * @param {string} data.tenantId
   * @param {string} [data.clienteId]
   * @param {string} [data.nombre]
   * @param {string} data.direccion
   * @param {string} data.zonaId
   * @param {object} [data.reglas]
   * @param {Date}   [data.creadoEn]
   */
  constructor({
    id,
    tenantId,
    clienteId,
    nombre,
    direccion,
    zonaId,
    reglas = null,
    creadoEn = new Date(),
  }) {
    this.id = id;
    this.tenantId = tenantId;
    this.clienteId = clienteId ?? null;
    this.direccion = direccion ? direccion.trim() : '';
    this.nombre = nombre ? nombre.trim() : this.direccion;
    this.zonaId = zonaId ? zonaId.trim() : '';
    this.reglas = reglas && typeof reglas === 'object' ? reglas : null;
    this.creadoEn = creadoEn;
  }

  validate() {
    if (!this.tenantId) {
      throw new Error('tenantId es requerido para el sitio');
    }
    if (!this.direccion || this.direccion.length < 5) {
      throw new Error('direccion del sitio es requerida (mínimo 5 caracteres)');
    }
    if (!this.zonaId) {
      throw new Error('zonaId es requerida (RF-09: todo sitio debe pertenecer a una zona del catálogo)');
    }
    return true;
  }
}

module.exports = Site;
