const { ValidationError } = require('../errors/DomainError');

/**
 * Entidad de Dominio: Sitio de Servicio (Site)
 * Representa una sede, sucursal o dirección asociada a un cliente (RF-08 / RF-09 / US-02.2.2).
 *
 * Regla de negocio crítica (RF-09):
 * Todo sitio debe tener una zona asignada del catálogo del tenant;
 * sin zona no puede originar solicitudes de mantenimiento.
 */
class Site {
  /**
   * @param {object} data
   * @param {string} [data.id]
   * @param {string} data.tenantId     - Tenant al que pertenece
   * @param {string} [data.clienteId]  - ID del cliente propietario de la sede
   * @param {string} [data.nombre]     - Nombre identificador (ej: "Sede Norte", "Planta 1")
   * @param {string} data.direccion    - Dirección física del inmueble
   * @param {string} data.zonaId       - Zona de cobertura geográfica (RF-09: obligatoria)
   * @param {object} [data.reglas]     - Reglas de acceso / operativas (horarios, EPIs, etc.)
   * @param {Date}   [data.creadoEn]
   */
  constructor({
    id,
    tenantId,
    clienteId,
    nombre,
    direccion,
    zonaId,
    contactoNombre = null,
    contactoTelefono = null,
    reglas = null,
    creadoEn = new Date(),
  }) {
    this.id = id;
    this.tenantId = tenantId;
    this.clienteId = clienteId ?? null;
    this.direccion = direccion ? direccion.trim() : '';
    this.nombre = nombre ? nombre.trim() : this.direccion;
    this.zonaId = zonaId ? zonaId.trim() : '';
    this.contactoNombre = contactoNombre ? contactoNombre.trim() : null;
    this.contactoTelefono = contactoTelefono ? contactoTelefono.trim() : null;
    this.reglas = reglas && typeof reglas === 'object' ? reglas : null;
    this.creadoEn = creadoEn;
  }

  get clientId() {
    return this.clienteId;
  }

  /**
   * Valida las reglas de negocio de la sede o sitio.
   * @throws {ValidationError} si falta algún campo obligatorio.
   */
  validate() {
    if (!this.tenantId) {
      throw new ValidationError('tenantId es requerido para el sitio', 'VALIDATION_ERROR');
    }
    if (!this.direccion || this.direccion.length < 5) {
      throw new ValidationError('direccion del sitio es requerida (mínimo 5 caracteres)', 'VALIDATION_ERROR');
    }
    if (!this.zonaId) {
      throw new ValidationError('zonaId es requerida (RF-09: todo sitio debe pertenecer a una zona del catálogo)', 'VALIDATION_ERROR');
    }
    return true;
  }

  toJSON() {
    return {
      id: this.id,
      tenantId: this.tenantId,
      clienteId: this.clienteId,
      nombre: this.nombre,
      direccion: this.direccion,
      zonaId: this.zonaId,
      contactoNombre: this.contactoNombre,
      contactoTelefono: this.contactoTelefono,
      reglas: this.reglas,
      creadoEn: this.creadoEn,
    };
  }
}

Site.Site = Site;
module.exports = Site;
