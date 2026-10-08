const { ValidationError } = require('../../../domain/errors/DomainError');

/**
 * Entidad de Dominio: Cliente Empresa (CompanyClient)
 * Representa a una organización corporativa como cliente final (RF-08 / US-02.2.2 / Migración 007).
 * Un cliente empresa puede registrar y administrar múltiples sitios de servicio asociados.
 */
class CompanyClient {
  /**
   * @param {object} data
   * @param {string} [data.id]
   * @param {string} [data.usuarioId]        - Identificador de usuario asociado en public.usuario
   * @param {string} data.tenantId           - Identificador del tenant
   * @param {string} data.razonSocial        - Razón social o nombre legal de la empresa
   * @param {string} data.nit                - Número de Identificación Tributaria
   * @param {string} data.email              - Correo corporativo de contacto
   * @param {string} [data.telefono]         - Teléfono de contacto
   * @param {string} [data.nombreRepresentante] - Nombre del representante legal o contacto principal
   * @param {string} [data.tipo]             - 'PERSONA_JURIDICA' (Migración 007)
   * @param {string} [data.estado]           - 'ACTIVO'
   * @param {Date}   [data.creadoEn]
   */
  constructor({
    id,
    usuarioId,
    tenantId,
    razonSocial,
    nit,
    email,
    telefono,
    nombreRepresentante,
    tipo = 'PERSONA_JURIDICA',
    estado = 'ACTIVO',
    creadoEn = new Date(),
  }) {
    this.id = id;
    this.usuarioId = usuarioId;
    this.tenantId = tenantId;
    this.razonSocial = razonSocial ? razonSocial.trim() : '';
    this.nit = nit ? nit.trim() : '';
    this.email = email ? email.trim().toLowerCase() : '';
    this.telefono = telefono ? telefono.trim() : null;
    this.nombreRepresentante = nombreRepresentante ? nombreRepresentante.trim() : null;
    this.tipo = tipo === 'EMPRESA' ? 'PERSONA_JURIDICA' : tipo;
    this.estado = estado;
    this.creadoEn = creadoEn;
  }

  /**
   * Valida las reglas de negocio de la entidad CompanyClient.
   * @throws {ValidationError} si alguna regla de validación no se cumple.
   */
  validate() {
    if (!this.tenantId) {
      throw new ValidationError('tenantId es requerido', 'VALIDATION_ERROR');
    }
    if (!this.razonSocial || this.razonSocial.length < 2) {
      throw new ValidationError('razonSocial es requerida (mínimo 2 caracteres)', 'VALIDATION_ERROR');
    }
    if (!this.nit || this.nit.length < 5) {
      throw new ValidationError('nit es requerido (mínimo 5 caracteres)', 'VALIDATION_ERROR');
    }
    if (!this.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email)) {
      throw new ValidationError('email corporativo inválido', 'VALIDATION_ERROR');
    }
    if (this.tipo !== 'PERSONA_JURIDICA' && this.tipo !== 'EMPRESA') {
      throw new ValidationError('tipo de cliente debe ser PERSONA_JURIDICA para cliente corporativo', 'VALIDATION_ERROR');
    }
    this.tipo = 'PERSONA_JURIDICA';
    return true;
  }
}

module.exports = { CompanyClient };
