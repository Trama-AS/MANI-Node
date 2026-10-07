/**
 * Entidad de Dominio: Cliente Empresa (CompanyClient)
 * Representa a una organización corporativa como cliente final (RF-08 / US-02.2.2).
 * Un cliente empresa puede registrar y administrar múltiples sitios de servicio asociados.
 */
class CompanyClient {
  /**
   * @param {object} data
   * @param {string} [data.id]
   * @param {string} data.tenantId           - Identificador del tenant
   * @param {string} data.razonSocial        - Razón social o nombre legal de la empresa
   * @param {string} data.nit                - Número de Identificación Tributaria
   * @param {string} data.email              - Correo corporativo de contacto
   * @param {string} [data.telefono]         - Teléfono de contacto
   * @param {string} [data.nombreRepresentante] - Nombre del representante legal o contacto principal
   * @param {string} [data.tipo]             - 'EMPRESA' (RF-08)
   * @param {string} [data.estado]           - 'ACTIVO'
   * @param {Date}   [data.creadoEn]
   */
  constructor({
    id,
    tenantId,
    razonSocial,
    nit,
    email,
    telefono,
    nombreRepresentante,
    tipo = 'EMPRESA',
    estado = 'ACTIVO',
    creadoEn = new Date(),
  }) {
    this.id = id;
    this.tenantId = tenantId;
    this.razonSocial = razonSocial ? razonSocial.trim() : '';
    this.nit = nit ? nit.trim() : '';
    this.email = email ? email.trim().toLowerCase() : '';
    this.telefono = telefono ? telefono.trim() : null;
    this.nombreRepresentante = nombreRepresentante ? nombreRepresentante.trim() : null;
    this.tipo = tipo;
    this.estado = estado;
    this.creadoEn = creadoEn;
  }

  /**
   * Valida las reglas de negocio de la entidad CompanyClient.
   * @throws {Error} si alguna regla de validación no se cumple.
   */
  validate() {
    if (!this.tenantId) {
      throw new Error('tenantId es requerido');
    }
    if (!this.razonSocial || this.razonSocial.length < 2) {
      throw new Error('razonSocial es requerida (mínimo 2 caracteres)');
    }
    if (!this.nit || this.nit.length < 5) {
      throw new Error('nit es requerido (mínimo 5 caracteres)');
    }
    if (!this.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email)) {
      throw new Error('email corporativo inválido');
    }
    if (this.tipo !== 'EMPRESA') {
      throw new Error('tipo de cliente debe ser EMPRESA para cliente corporativo');
    }
    return true;
  }
}

module.exports = { CompanyClient };
