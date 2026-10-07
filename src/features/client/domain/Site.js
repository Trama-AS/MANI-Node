const { SiteRules } = require('./SiteRules');

/**
 * Entidad de Dominio: Sitio de Servicio (Site)
 * Representa una sede, sucursal o dirección asociada a un cliente (RF-08 / RF-09 / US-02.2.2 / US-02.2.3).
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
   * @param {object|SiteRules} [data.reglas] - Reglas de acceso / operativas (horarios, EPIs, etc.)
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

  /**
   * Asigna y valida las reglas contextuales del sitio.
   * @param {object|SiteRules|null} rulesInput
   */
  setRules(rulesInput) {
    if (!rulesInput) {
      this.reglas = null;
      return;
    }
    const rulesInstance =
      rulesInput instanceof SiteRules ? rulesInput : new SiteRules(rulesInput);
    rulesInstance.validate();
    this.reglas = rulesInstance;
  }

  /**
   * Obtiene la instancia de SiteRules asociada al sitio.
   * @returns {SiteRules}
   */
  getSiteRules() {
    if (!this.reglas) return new SiteRules();
    if (this.reglas instanceof SiteRules) return this.reglas;
    return new SiteRules(this.reglas);
  }

  /**
   * Valida las reglas de negocio de la sede o sitio.
   * @throws {Error} si falta algún campo obligatorio.
   */
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

module.exports = { Site };
